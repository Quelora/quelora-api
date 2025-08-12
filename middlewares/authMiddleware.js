// middlewares/authMiddleware.js
const { validateToken } = require('../services/authService');


function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token not provided or incorrect format.' });
  }

  const token = authHeader.split(' ')[1];
  const clientIp = req.ip;

  try {
    const payload = validateToken(token, clientIp);
    req.user = payload;
    next();
  } catch (error) {
    return res.status(401).json({ message: error.message });
  }
}

module.exports = authMiddleware;