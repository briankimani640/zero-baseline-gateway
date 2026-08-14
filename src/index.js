require('dotenv').config();
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const bcrypt = require('bcrypt');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const app = express();

app.use(express.json());

// Health Check Endpoint
app.get('/api/status', async (req, res) => {
    try {
        const userCount = await prisma.user.count();
        res.json({
            status: 'Success',
            message: 'Zero-Baseline Gateway is online.',
            databaseConnected: true,
            totalUsers: userCount
        });
    } catch (error) {
        console.error("Database connection failed:", error);
        res.status(500).json({ error: 'Failed to connect to the database.' });
    }
});

// User Registration
app.post('/api/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await prisma.user.create({
            data: {
                email: email,
                passwordHash: hashedPassword,
                portfolios: {
                    create: {
                        assetType: 'FIAT',
                        assetSymbol: 'KES', 
                        balance: 0.0
                    }
                }
            },
            include: { portfolios: true }
        });

        res.json({
            status: 'Success',
            message: 'User registered with a strictly zeroed portfolio.',
            user: { id: user.id, email: user.email, portfolio: user.portfolios }
        });
    } catch (error) {
        console.error("Registration failed:", error);
        res.status(400).json({ error: 'Registration failed. Email might already exist.' });
    }
});

// NEW: The Transaction Engine - Processing Deposits
app.post('/api/deposit', async (req, res) => {
    try {
        const { email, amount, assetSymbol } = req.body;

        // 1. Find the user by their email
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return res.status(404).json({ error: 'User not found' });

        // 2. Ensure the amount is a positive deposit
        if (amount <= 0) return res.status(400).json({ error: 'Deposit amount must be greater than zero' });

        // 3. Execute an Atomic Transaction: Create ledger entry AND update balance together
        const result = await prisma.$transaction([
            prisma.transaction.create({
                data: {
                    userId: user.id,
                    transactionType: 'DEPOSIT',
                    assetSymbol: assetSymbol,
                    amount: amount
                }
            }),
            prisma.portfolio.update({
                where: {
                    userId_assetSymbol: {
                        userId: user.id,
                        assetSymbol: assetSymbol
                    }
                },
                data: {
                    balance: { increment: amount } // Safely adds to the existing balance
                }
            })
        ]);

        res.json({
            status: 'Success',
            message: `Successfully deposited ${amount} ${assetSymbol}.`,
            transactionRecord: result[0],
            updatedPortfolio: result[1]
        });

    } catch (error) {
        console.error("Deposit failed:", error);
        res.status(500).json({ error: 'Transaction failed. Ensure the portfolio exists.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});