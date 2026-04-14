const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { logActivity } = require('../lib/activity');
const emailService = require('../lib/email');
const { setSessionCookie, clearSessionCookie } = require('../lib/session');

const router = express.Router();

function createAuthToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
}

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string }
 *               password: { type: string, minLength: 8 }
 *               name: { type: string }
 *     responses:
 *       201:
 *         description: User created
 *       409:
 *         description: Email already exists
 */
router.post('/register', async (req, res, next) => {
  try {
    // Beta mode: block new registrations
    if (process.env.BETA_MODE === 'true') {
      return res.status(403).json({ error: 'Registration is closed during the private beta period. Check back soon!' });
    }

    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, password: hashed, name },
      select: { id: true, email: true, name: true, role: true, orgId: true, createdAt: true }
    });

    const token = createAuthToken(user);
    setSessionCookie(res, token);

    logActivity('register', { userId: user.id, userEmail: user.email, ip: req.ip });
    res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Login successful
 *       401:
 *         description: Invalid credentials
 */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Account lockout check
    if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
      const remaining = Math.ceil((new Date(user.lockedUntil) - new Date()) / 1000);
      return res.status(423).json({ error: `Account temporarily locked. Try again in ${remaining} seconds.` });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      // Increment failed attempts and lock if threshold exceeded
      const attempts = (user.failedLoginAttempts || 0) + 1;
      const MAX_ATTEMPTS = 5;
      const updates = { failedLoginAttempts: attempts };
      if (attempts >= MAX_ATTEMPTS) {
        // Exponential backoff: 1min, 2min, 4min, 8min, ...
        const lockMinutes = Math.pow(2, Math.min(attempts - MAX_ATTEMPTS, 6));
        updates.lockedUntil = new Date(Date.now() + lockMinutes * 60 * 1000);
      }
      await prisma.user.update({ where: { id: user.id }, data: updates });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Reset failed attempts on successful login
    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
    }

    const token = createAuthToken(user);
    setSessionCookie(res, token);

    logActivity('login', { userId: user.id, userEmail: user.email, ip: req.ip });
    res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role, orgId: user.orgId }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get current user
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user info
 */
const authMiddleware = require('../middleware/auth');
router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, name: true, role: true, orgId: true, createdAt: true }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.status(204).send();
});

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     summary: Request password reset email
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string }
 *     responses:
 *       200:
 *         description: Reset email sent (always returns 200 to avoid email enumeration)
 */
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    // Always return success to prevent email enumeration
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      // Invalidate any existing tokens for this user
      await prisma.passwordResetToken.updateMany({
        where: { userId: user.id, used: false },
        data: { used: true }
      });

      await prisma.passwordResetToken.create({
        data: {
          tokenHash,
          userId: user.id,
          email: user.email,
          expiresAt: new Date(Date.now() + 3600000) // 1 hour
        }
      });

      // Clean expired tokens periodically (fire-and-forget)
      prisma.passwordResetToken.deleteMany({
        where: { expiresAt: { lt: new Date() } }
      }).catch(() => {});

      await emailService.sendPasswordReset(email, token);
      logActivity('password_reset_request', { userId: user.id, userEmail: user.email, ip: req.ip });
    }

    res.json({ message: 'If an account with that email exists, a reset link has been sent.' });
  } catch (err) {
    next(err);
  }
});

/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     summary: Reset password with token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, password]
 *             properties:
 *               token: { type: string }
 *               password: { type: string, minLength: 8 }
 *     responses:
 *       200:
 *         description: Password reset successful
 *       400:
 *         description: Invalid or expired token
 */
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and password are required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const entry = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!entry || entry.used || new Date(entry.expiresAt) < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const hashed = await bcrypt.hash(password, 12);
    await prisma.user.update({
      where: { id: entry.userId },
      data: { password: hashed, failedLoginAttempts: 0, lockedUntil: null }
    });

    await prisma.passwordResetToken.update({ where: { id: entry.id }, data: { used: true } });
    logActivity('password_reset', { userId: entry.userId, userEmail: entry.email, ip: req.ip });
    res.json({ message: 'Password has been reset successfully' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
