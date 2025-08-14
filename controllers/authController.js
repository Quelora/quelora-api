// ./controllers/authController.js
const User = require('../models/User');
const { encryptJSON, generateKeyFromString } = require('../utils/cipher');
const { generateToken, renewAdminToken } = require('../services/authService');
const { validatePasswordStrength } = require('../utils/password.js');

exports.generateToken = async (req, res) => {
  try {
    const { username, password } = req.body;
    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await User.findOne({ username });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await user.comparePassword(password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const clients = user.clients.map(client => ({
      cid: client.cid,
      description: client.description,
      config: encryptJSON( user.decryptConf(client.config), generateKeyFromString(client.cid)),
      postConfig: encryptJSON( user.decryptConf(client.postConfig), generateKeyFromString(client.cid)),
      vapid: encryptJSON(user.decryptVapid(client.vapid), generateKeyFromString(client.cid)),
      email: encryptJSON(user.decryptEmail(client.email), generateKeyFromString(client.cid)),
    }));

    const token = generateToken(
      user._id.toString(),
      user.username,
      clientIp,
      user.role === 'admin'
    );

    res.json({
      token,
      expiresIn: user.role === 'admin' ? process.env.JWT_ADMIN_TTL : process.env.JWT_TTL,
      role: user.role,
      clients: clients
    });

  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.renewAdminToken = async (req, res) => {
  try {
    const { expiredToken } = req.body;
    const clientIp = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    if (!expiredToken) {
      return res.status(400).json({ error: 'Expired token is required' });
    }

    const newToken = renewAdminToken(expiredToken, clientIp);

    res.json({
      token: newToken,
      expiresIn: process.env.JWT_ADMIN_TTL,
      role: 'admin'
    });

  } catch (error) {
    console.error('Token renewal error:', error);
    res.status(401).json({ error: error.message });
  }
};

exports.updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user._id;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({ error: 'New password must be different from current password' });
    }

    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.valid) {
      return res.status(400).json({ error: passwordValidation.message });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verificar la contraseña actual
    const validPassword = await user.comparePassword(currentPassword);
    if (!validPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Actualizar la contraseña
    user.password = newPassword;
    await user.save();

    res.json({ message: 'Password updated successfully' });

  } catch (error) {
    console.error('Password update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};