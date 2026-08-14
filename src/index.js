require('dotenv').config();
const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

// In Prisma 7, we must configure the database driver adapter explicitly
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const app = express();

// Middleware to allow our API to understand JSON data
app.use(express.json());

// Our first endpoint: A Health Check
app.get('/api/status', async (req, res) => {
    try {
        // We attempt a simple query to ensure the database is connected
        const userCount = await prisma.user.count();
        
        res.json({
            status: 'Success',
            message: 'Zero-Baseline Gateway is online.',
            databaseConnected: true,
            totalUsers: userCount
        });
    } catch (error) {
        console.error("Database connection failed:", error);
        res.status(500).json({
            status: 'Error',
            message: 'Failed to connect to the database.'
        });
    }
});

// Start the server on port 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});