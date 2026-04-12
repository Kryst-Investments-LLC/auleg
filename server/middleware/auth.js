const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../lib/prisma');

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  // API key auth: "Bearer auleg_..."
  if (header.startsWith('Bearer auleg_')) {
    const rawKey = header.slice(7);
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    try {
      const apiKey = await prisma.apiKey.findUnique({ where: { keyHash } });
      if (!apiKey) {
        return res.status(401).json({ error: 'Invalid API key' });
      }
      if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) {
        return res.status(401).json({ error: 'API key has expired' });
      }

      // Load user
      const user = await prisma.user.findUnique({ where: { id: apiKey.userId } });
      if (!user) {
        return res.status(401).json({ error: 'API key user not found' });
      }

      req.user = { id: user.id, email: user.email, role: user.role, orgId: user.orgId };
      req.apiKey = { id: apiKey.id, scopes: apiKey.scopes.split(',') };

      // Update lastUsed (fire-and-forget)
      prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsed: new Date() } }).catch(() => {});

      return next();
    } catch {
      return res.status(401).json({ error: 'API key authentication failed' });
    }
  }

  // JWT auth: "Bearer <jwt>"
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Invalid authorization format' });
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = authMiddleware;
