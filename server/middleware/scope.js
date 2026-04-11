/**
 * Scope-checking middleware for API key access control.
 * Checks req.apiKey.scopes for the required scope.
 * JWT-authenticated users bypass scope checks (full access).
 */
function requireScope(...requiredScopes) {
  return (req, res, next) => {
    // JWT users have full access (no apiKey means JWT)
    if (!req.apiKey) return next();

    const userScopes = req.apiKey.scopes || [];
    const hasAll = requiredScopes.every(s => userScopes.includes(s));
    if (!hasAll) {
      return res.status(403).json({
        error: 'Insufficient API key scope',
        required: requiredScopes,
        granted: userScopes
      });
    }
    next();
  };
}

module.exports = { requireScope };
