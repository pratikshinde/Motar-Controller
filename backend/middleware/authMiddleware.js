/**
 * AgriPump SmartSpace - JWT Authentication & RBAC Authorization Middleware
 */
const { verifyToken } = require('../services/jwtAuth');

/**
 * Verifies Bearer Token in Authorization header.
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({ error: 'Access denied: Missing or malformed Bearer Token in Authorization header' });
  }

  const user = verifyToken(token);
  if (!user) {
    return res.status(403).json({ error: 'Access denied: Invalid or expired authentication token. Please sign in again.' });
  }

  req.user = user;
  next();
}

/**
 * Enforces role-based authorization check against token payload role.
 */
function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Permission Denied: Account role '${req.user ? req.user.role : 'unauthenticated'}' is not authorized to perform this operation. Required role: [${allowedRoles.join(', ')}]`
      });
    }
    next();
  };
}

module.exports = { authenticateToken, requireRole };
