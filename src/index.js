require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

// Initialize App & Database Connection
const app = express();
const prisma = new PrismaClient();

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

// 1. NEW: Account Initialization (Registration)
app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: 'An account with this email already exists.' });
    }

    // Hash the password securely
    const passwordHash = await bcrypt.hash(password, 10);

    // Create the user AND their default zero-baseline portfolios simultaneously
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
    console.error(error);
    res.status(500).json({ error: 'Failed to initialize account.' });
  }
});

// 2. UPDATED: Real Database Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Find the user in PostgreSQL
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    // Compare the provided password with the stored hash
    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) return res.status(400).json({ error: 'Invalid credentials' });

    // Generate Token containing the user's secure database ID
    const token = jwt.sign({ id: user.id, email: user.email }, SECRET_KEY, { expiresIn: '1h' });
    res.json({ status: 'Success', token: token });
  } catch (error) {
    res.status(500).json({ error: 'Login process failed.' });
  }
});

// 3. UPDATED: Real Database Dashboard
app.get('/api/dashboard', authenticateToken, async (req, res) => {
  try {
    // Fetch the user and their associated portfolios from the database
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { portfolios: true }
    });

    if (!user) return res.status(404).json({ error: 'User data not found.' });

    // Send the real data back to the mobile app
    res.json({ 
      status: 'Success', 
      data: { email: user.email, portfolios: user.portfolios } 
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve ledger data.' });
  }
});

// 4. Transfer Endpoint (Wiring pending next step)
app.post('/api/transfer', authenticateToken, async (req, res) => {
  try {
    const { recipient, amount } = req.body;
    const sender = req.user.email;

    if (!recipient || !amount) return res.status(400).json({ error: 'Recipient and amount required.' });

    console.log(`[PENDING TRANSACTION] ${sender} requesting transfer of ${amount} to ${recipient}`);

    res.json({ status: 'Success', message: `Transfer request received for ${amount} to ${recipient}.` });
  } catch (error) {
    res.status(500).json({ error: 'Transaction failed.' });
  }
});

// --- SERVER STARTUP ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running securely on http://localhost:${PORT}`);
});