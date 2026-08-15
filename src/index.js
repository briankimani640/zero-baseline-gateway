require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');

// Initialize Express App
const app = express();

// Security and Data Middleware
app.use(cors());
app.use(express.json());

// In a production app, this comes from your .env file
const SECRET_KEY = process.env.JWT_SECRET || 'YOUR_SECRET_KEY';

// --- MIDDLEWARE ---
// This checks if the user's token is valid before letting them access secure data
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

// 1. Login Endpoint
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  
  // Basic validation (You will replace this with a Prisma DB check later)
  if (email && password) {
    const token = jwt.sign({ email: email }, SECRET_KEY, { expiresIn: '1h' });
    res.json({ status: 'Success', token: token });
  } else {
    res.status(400).json({ error: 'Invalid credentials' });
  }
});

// 2. Dashboard Endpoint (Protected)
app.get('/api/dashboard', authenticateToken, async (req, res) => {
  try {
    // Mocking user database data for the frontend to render
    const safeUserData = {
      email: req.user.email,
      portfolios: [
        { id: 1, assetSymbol: 'KES', balance: 45000 },
        { id: 2, assetSymbol: 'SOL', balance: 12.5 }
      ]
    };
    res.json({ status: 'Success', data: safeUserData });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve dashboard data.' });
  }
});

// 3. NEW: Transfer Endpoint (Protected)
app.post('/api/transfer', authenticateToken, async (req, res) => {
  try {
    const { recipient, amount } = req.body;
    const sender = req.user.email;

    if (!recipient || !amount) {
      return res.status(400).json({ error: 'Recipient and amount are required.' });
    }

    // Process the Database Transaction
    console.log(`[LEDGER UPDATE] User ${sender} transferring ${amount} to ${recipient}`);

    res.json({ 
      status: 'Success', 
      message: `Successfully transferred ${amount} to ${recipient}.` 
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to process transaction.' });
  }
});

// --- SERVER STARTUP ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running securely on http://localhost:${PORT}`);
});