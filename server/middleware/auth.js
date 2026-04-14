const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { getSessionTokenFromRequest } = require('../lib/session');

async function loadUserContext(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, orgId: true }
  });

  return user;
}

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  const sessionToken = getSessionTokenFromRequest(req);

  // API key auth: "Bearer auleg_..."
  if (header && header.startsWith('Bearer auleg_')) {
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
      const user = await loadUserContext(apiKey.userId);
      if (!user) {
        return res.status(401).json({ error: 'API key user not found' });
      }

      req.user = user;
      req.apiKey = { id: apiKey.id, scopes: apiKey.scopes.split(',') };

      // Update lastUsed (fire-and-forget)
      prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsed: new Date() } }).catch(() => {});

      return next();
    } catch {
      return res.status(401).json({ error: 'API key authentication failed' });
    }
  }

  let token = sessionToken;

  if (header) {
    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Invalid authorization format' });
    }

    token = header.slice(7);
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // JWT auth: "Bearer <jwt>" or cookie-backed session
  if (token.startsWith('auleg_')) {
    return res.status(401).json({ error: 'Invalid authorization format' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const user = await loadUserContext(payload.id);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = authMiddleware;
