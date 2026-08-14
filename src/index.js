require('dotenv').config();
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken'); // NEW: JWT import

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const app = express();

app.use(express.json());

// 1. Health Check
app.get('/api/status', async (req, res) => {
    try {
        const userCount = await prisma.user.count();
        res.json({ status: 'Success', databaseConnected: true, totalUsers: userCount });
    } catch (error) {
        res.status(500).json({ error: 'Failed to connect to the database.' });
    }
});

// 2. User Registration
app.post('/api/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await prisma.user.create({
            data: {
                email,
                passwordHash: hashedPassword,
                portfolios: { create: { assetType: 'FIAT', assetSymbol: 'KES', balance: 0.0 } }
            },
            include: { portfolios: true }
        });
        res.json({ status: 'Success', user: { id: user.id, email: user.email, portfolio: user.portfolios } });
    } catch (error) {
        res.status(400).json({ error: 'Registration failed. Email might already exist.' });
    }
});

// NEW: 3. User Login & Token Generation
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Find the user
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Verify the password using bcrypt
        const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
        if (!isPasswordValid) return res.status(401).json({ error: 'Invalid credentials' });

        // Generate the JWT key (valid for 1 hour)
        const token = jwt.sign(
            { userId: user.id, email: user.email }, 
            process.env.JWT_SECRET, 
            { expiresIn: '1h' }
        );

        res.json({ status: 'Success', message: 'Login successful', token });
    } catch (error) {
        res.status(500).json({ error: 'Login failed.' });
    }
});

// 4. Process Deposit
app.post('/api/deposit', async (req, res) => {
    try {
        const { email, amount, assetSymbol } = req.body;
        const user = await prisma.user.findUnique({ where: { email } });
        
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (amount <= 0) return res.status(400).json({ error: 'Deposit amount must be greater than zero' });

        const result = await prisma.$transaction([
            prisma.transaction.create({
                data: { userId: user.id, transactionType: 'DEPOSIT', assetSymbol, amount }
            }),
            prisma.portfolio.upsert({
                where: { userId_assetSymbol: { userId: user.id, assetSymbol } },
                update: { balance: { increment: amount } },
                create: { userId: user.id, assetType: 'CRYPTO', assetSymbol, balance: amount }
            })
        ]);
        res.json({ status: 'Success', updatedPortfolio: result[1] });
    } catch (error) {
        res.status(500).json({ error: 'Transaction failed.' });
    }
});

// 5. Process Withdrawal
app.post('/api/withdraw', async (req, res) => {
    try {
        const { email, amount, assetSymbol } = req.body;
        const user = await prisma.user.findUnique({ where: { email }, include: { portfolios: true } });
        
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (amount <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });

        const portfolio = user.portfolios.find(p => p.assetSymbol === assetSymbol);
        
        if (!portfolio || portfolio.balance < amount) {
            return res.status(400).json({ error: 'Insufficient funds. Strict zero-baseline enforced.' });
        }

        const result = await prisma.$transaction([
            prisma.transaction.create({
                data: { userId: user.id, transactionType: 'WITHDRAWAL', assetSymbol, amount: -amount }
            }),
            prisma.portfolio.update({
                where: { userId_assetSymbol: { userId: user.id, assetSymbol } },
                data: { balance: { decrement: amount } }
            })
        ]);
        res.json({ status: 'Success', updatedPortfolio: result[1] });
    } catch (error) {
        res.status(500).json({ error: 'Transaction failed.' });
    }
});

// 6. Internal Asset Swap
app.post('/api/swap', async (req, res) => {
    try {
        const { email, fromAsset, toAsset, amountToSwap } = req.body;
        const MOCK_EXCHANGE_RATES = { 'KES_TO_SOL': 1 / 20000, 'SOL_TO_KES': 20000 };
        const rate = MOCK_EXCHANGE_RATES[`${fromAsset}_TO_${toAsset}`];

        if (!rate) return res.status(400).json({ error: 'Trading pair not supported.' });
        if (amountToSwap <= 0) return res.status(400).json({ error: 'Swap amount must be greater than zero' });

        const amountToReceive = amountToSwap * rate;

        const swapResult = await prisma.$transaction(async (tx) => {
            const user = await tx.user.findUnique({ where: { email }, include: { portfolios: true } });
            if (!user) throw new Error('User not found');

            const fromPortfolio = user.portfolios.find(p => p.assetSymbol === fromAsset);
            if (!fromPortfolio || fromPortfolio.balance < amountToSwap) {
                throw new Error(`Insufficient ${fromAsset} balance for swap.`);
            }

            await tx.portfolio.update({
                where: { userId_assetSymbol: { userId: user.id, assetSymbol: fromAsset } },
                data: { balance: { decrement: amountToSwap } }
            });
            await tx.transaction.create({
                data: { userId: user.id, transactionType: 'SWAP_OUT', assetSymbol: fromAsset, amount: -amountToSwap }
            });

            const toPortfolio = await tx.portfolio.upsert({
                where: { userId_assetSymbol: { userId: user.id, assetSymbol: toAsset } },
                update: { balance: { increment: amountToReceive } },
                create: { userId: user.id, assetType: toAsset === 'SOL' ? 'CRYPTO' : 'FIAT', assetSymbol: toAsset, balance: amountToReceive }
            });
            await tx.transaction.create({
                data: { userId: user.id, transactionType: 'SWAP_IN', assetSymbol: toAsset, amount: amountToReceive }
            });

            return { toPortfolio, amountToReceive };
        }, { maxWait: 10000, timeout: 20000 });

        res.json({ status: 'Success', message: `Swapped ${amountToSwap} ${fromAsset} for ${swapResult.amountToReceive} ${toAsset}.`, newBalance: swapResult.toPortfolio });
    } catch (error) {
        res.status(400).json({ error: error.message || 'Swap failed.' });
    }
});

// 7. Fetch Full Dashboard
app.get('/api/dashboard/:email', async (req, res) => {
    try {
        const { email } = req.params;
        const userDashboard = await prisma.user.findUnique({
            where: { email },
            include: { portfolios: true, transactions: { orderBy: { timestamp: 'desc' }, take: 10 } }
        });
        
        if (!userDashboard) return res.status(404).json({ error: 'User not found' });
        
        const { passwordHash, ...safeUserData } = userDashboard;
        res.json({ status: 'Success', data: safeUserData });
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve dashboard data.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is running on http://localhost:${PORT}`));