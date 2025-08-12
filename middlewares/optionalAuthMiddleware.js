// middlewares/optionalAuthMiddleware.js
const { validateToken } = require('../services/authService');

function optionalAuthMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader) {
    return next();
  }

  const tokenParts = authHeader.split(' ');
  if (tokenParts.length !== 2 || tokenParts[0] !== 'Bearer') {
    return next(); 
  }

  const token = tokenParts[1];
  const clientIp = req.ip;

  try {
    const payload = validateToken(token, clientIp);
    req.user = payload;
    next();
  } catch (error) {
    next();
  }
}

module.exports = optionalAuthMiddleware;