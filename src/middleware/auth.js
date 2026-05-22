'use strict';

const { ClerkExpressRequireAuth } = require('@clerk/clerk-sdk-node');
const sqlite3 = require('sqlite3').verbose();
const path    = require('path');

const DB_PATH = process.env.DATABASE_PATH
  || path.join(__dirname, '../../database/leadmechanic.db');

const requireAuth = ClerkExpressRequireAuth();

const requireShop = async (req, res, next) => {
  const db      = new sqlite3.Database(DB_PATH);
  const clerkId = req.auth.userId;
  db.get('SELECT * FROM shops WHERE clerk_user_id = ?', [clerkId], (err, shop) => {
    db.close();
    if (err) return res.status(500).json({ error: 'DB_ERROR', detail: 'Failed to load shop profile' });
    if (!shop) return res.status(403).json({ error: 'SHOP_NOT_FOUND', detail: 'Your account is pending approval. Contact ApexFitment.' });
    if (shop.status === 'pending')   return res.status(403).json({ error: 'PENDING_APPROVAL', detail: 'Your shop is pending approval. We will notify you within 24h.' });
    if (shop.status === 'suspended') return res.status(403).json({ error: 'ACCOUNT_SUSPENDED', detail: 'Account suspended. Contact support@apexfitment.com' });
    req.shop = shop;
    next();
  });
};

const requireAdmin = (req, res, next) => {
  if (req.shop?.plan !== 'admin') {
    return res.status(403).json({ error: 'FORBIDDEN', detail: 'Admin access required' });
  }
  next();
};

module.exports = { requireAuth, requireShop, requireAdmin };
