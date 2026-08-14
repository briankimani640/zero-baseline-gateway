require('dotenv').config();
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const bcrypt = require('bcrypt');

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
                email: email,
                passwordHash: hashedPassword,
                portfolios: {
                    create: { assetType: 'FIAT', assetSymbol: 'KES', balance: 0.0 }
                }
            },
            include: { portfolios: true }
        });

        res.json({ status: 'Success', user: { id: user.id, email: user.email, portfolio: user.portfolios } });
    } catch (error) {
        res.status(400).json({ error: 'Registration failed. Email might already exist.' });
    }
});

// 3. Process Deposit
app.post('/api/deposit', async (req, res) => {
    try {
        const { email, amount, assetSymbol } = req.body;
        const user = await prisma.user.findUnique({ where: { email } });
        
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (amount <= 0) return res.status(400).json({ error: 'Deposit amount must be greater than zero' });

        const result = await prisma.$transaction([
            prisma.transaction.create({
                data: { userId: user.id, transactionType: 'DEPOSIT', assetSymbol: assetSymbol, amount: amount }
            }),
            prisma.portfolio.update({
                where: { userId_assetSymbol: { userId: user.id, assetSymbol: assetSymbol } },
                data: { balance: { increment: amount } }
            })
        ]);

        res.json({ status: 'Success', updatedPortfolio: result[1] });
    } catch (error) {
        res.status(500).json({ error: 'Transaction failed.' });
    }
});

// NEW 4. Fetch Full Dashboard
app.get('/api/dashboard/:email', async (req, res) => {
    try {
        const { email } = req.params;

        // Fetch user, their portfolios, and their 10 most recent transactions
        const userDashboard = await prisma.user.findUnique({
            where: { email },
            include: {
                portfolios: true,
                transactions: {
                    orderBy: { timestamp: 'desc' },
                    take: 10
                }
            }
        });

        if (!userDashboard) return res.status(404).json({ error: 'User not found' });

        // Strip out the password hash before sending data back
        const { passwordHash, ...safeUserData } = userDashboard;

        res.json({
            status: 'Success',
            data: safeUserData
        });

    } catch (error) {
        console.error("Dashboard fetch failed:", error);
        res.status(500).json({ error: 'Failed to retrieve dashboard data.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});