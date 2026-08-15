require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const app = express();
app.use(cors());
app.use(express.json());

const SECRET_KEY = process.env.JWT_SECRET || 'YOUR_SECRET_KEY';

// --- MIDDLEWARE ---
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ error: 'Access Denied: No Token Provided' });

  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or Expired Token' });
    req.user = user; 
    next();
  });
}

// --- API ENDPOINTS ---

app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) return res.status(400).json({ error: 'An account with this email already exists.' });

    const passwordHash = await bcrypt.hash(password, 10);

    const newUser = await prisma.user.create({
      data: {
        email,
        passwordHash,
        portfolios: {
          create: [
            { assetType: 'FIAT', assetSymbol: 'KES', balance: 0.0 },
            { assetType: 'CRYPTO', assetSymbol: 'SOL', balance: 0.0 }
          ]
        }
      }
    });

    res.json({ status: 'Success', message: 'Secure account initialized successfully.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to initialize account.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, email: user.email }, SECRET_KEY, { expiresIn: '1h' });
    res.json({ status: 'Success', token: token });
  } catch (error) {
    res.status(500).json({ error: 'Login process failed.' });
  }
});

// UPDATED: Now fetches transactions ordered by newest first
app.get('/api/dashboard', authenticateToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { 
        portfolios: true,
        transactions: {
          orderBy: { timestamp: 'desc' },
          take: 20 // Let's limit to the 20 most recent records to keep the payload light
        }
      }
    });

    if (!user) return res.status(404).json({ error: 'User data not found.' });

    res.json({ 
      status: 'Success', 
      data: { 
        email: user.email, 
        portfolios: user.portfolios,
        transactions: user.transactions
      } 
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve ledger data.' });
  }
});

app.post('/api/deposit', authenticateToken, async (req, res) => {
  try {
    const { assetSymbol, amount } = req.body;
    const parsedAmount = parseFloat(amount);

    if (!assetSymbol || isNaN(parsedAmount) || parsedAmount <= 0) return res.status(400).json({ error: 'Valid asset symbol and amount required.' });

    await prisma.portfolio.update({
      where: { userId_assetSymbol: { userId: req.user.id, assetSymbol: assetSymbol } },
      data: { balance: { increment: parsedAmount } }
    });

    await prisma.transaction.create({
      data: { userId: req.user.id, transactionType: 'DEPOSIT', assetSymbol: assetSymbol, amount: parsedAmount, reference: 'SYSTEM_FUNDING' }
    });

    res.json({ status: 'Success', message: `Successfully deposited ${parsedAmount} ${assetSymbol}.` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to process deposit.' });
  }
});

app.post('/api/transfer', authenticateToken, async (req, res) => {
  try {
    const { recipient, amount, assetSymbol = 'KES' } = req.body;
    const senderId = req.user.id;
    const parsedAmount = parseFloat(amount);

    if (!recipient || isNaN(parsedAmount) || parsedAmount <= 0) return res.status(400).json({ error: 'Valid recipient and amount required.' });

    const recipientUser = await prisma.user.findUnique({ where: { email: recipient } });
    if (!recipientUser) return res.status(404).json({ error: 'Recipient account not found.' });

    await prisma.$transaction(async (tx) => {
      const senderPortfolio = await tx.portfolio.findUnique({
        where: { userId_assetSymbol: { userId: senderId, assetSymbol: assetSymbol } }
      });

      if (!senderPortfolio || senderPortfolio.balance < parsedAmount) throw new Error('Insufficient funds in the selected portfolio.');

      await tx.portfolio.update({
        where: { userId_assetSymbol: { userId: senderId, assetSymbol: assetSymbol } },
        data: { balance: { decrement: parsedAmount } }
      });

      await tx.portfolio.upsert({
        where: { userId_assetSymbol: { userId: recipientUser.id, assetSymbol: assetSymbol } },
        update: { balance: { increment: parsedAmount } },
        create: { userId: recipientUser.id, assetType: 'FIAT', assetSymbol: assetSymbol, balance: parsedAmount }
      });

      await tx.transaction.create({
        data: { userId: senderId, transactionType: 'TRANSFER_OUT', assetSymbol: assetSymbol, amount: -parsedAmount, reference: recipientUser.email }
      });
      await tx.transaction.create({
        data: { userId: recipientUser.id, transactionType: 'TRANSFER_IN', assetSymbol: assetSymbol, amount: parsedAmount, reference: req.user.email }
      });
    });

    res.json({ status: 'Success', message: `Transferred ${parsedAmount} ${assetSymbol} to ${recipient}.` });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Transaction failed.' });
  }
});

// --- SERVER STARTUP ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running securely on http://localhost:${PORT}`);
});