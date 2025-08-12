// ./middlewares/adminAuthMiddleware.js
const { validateToken } = require('../services/authService');
const User = require('../models/User');

async function adminAuthMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];

  // Check if the token is present and has the correct format
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token not provided or incorrect format.' });
  }

  const token = authHeader.split(' ')[1];
  const clientIp = req.ip;

  try {
    // Validate the Admin token
    const payload = validateToken(token, clientIp, true); // true indicates it's an Admin token

    // Check if the payload contains an email
    if (!payload.email) {
      return res.status(401).json({ message: 'The token does not contain a valid email.' });
    }

    // Find the user in the database by their email
    const user = await User.findOne({ username: payload.email });

    // Verify that the user exists and has the admin role
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admin privileges required.' });
    }

    // Attach the user to the `req` object for later use
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: `Authentication error: ${error.message}` });
  }
}

module.exports = adminAuthMiddleware;