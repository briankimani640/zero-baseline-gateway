require('dotenv').config();
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const bcrypt = require('bcrypt'); // newly added

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

// User Registration & Zero-Baseline Enforcement
app.post('/api/register', async (req, res) => {
    try {
        const { email, password } = req.body;

        // 1. Hash the password for security
        const hashedPassword = await bcrypt.hash(password, 10);

        // 2. Create the user AND an empty KES portfolio at the exact same time
        const user = await prisma.user.create({
            data: {
                email: email,
                passwordHash: hashedPassword,
                portfolios: {
                    create: {
                        assetType: 'FIAT',
                        assetSymbol: 'KES', 
                        balance: 0.0 // Enforcing the absolute zero baseline
                    }
                }
            },
            include: {
                portfolios: true // This tells Prisma to return the newly created portfolio in the response
            }
        });

        // 3. Send success response (never send the password hash back to the user)
        res.json({
            status: 'Success',
            message: 'User registered with a strictly zeroed portfolio.',
            user: {
                id: user.id,
                email: user.email,
                portfolio: user.portfolios
            }
        });

    } catch (error) {
        console.error("Registration failed:", error);
        // If the email is already taken, Prisma will throw an error
        res.status(400).json({ error: 'Registration failed. Email might already exist.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});