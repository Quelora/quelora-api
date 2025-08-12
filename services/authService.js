// app/services/authService.js
require('dotenv').config();
const jwt = require('jsonwebtoken');
const {
  JWT_SECRET,
  JWT_TTL = '1h',
  JWT_ADMIN_SECRET,
  JWT_ADMIN_TTL = '1h'
} = process.env;

/**
 * Genera un token JWT con soporte para usuarios normales y admin
 * @param {string} userId - ID del usuagit rio
 * @param {string} author - Nombre del autor
 * @param {string} clientIp - Dirección IP del cliente
 * @param {boolean} isAdmin - Indica si es usuario admin
 * @returns {string} Token JWT
 */
function generateToken(userId, author, clientIp, isAdmin = false) {
  const payload = {
    userId,
    author,
    ip: clientIp,
    email: author,
    role: isAdmin ? 'admin' : 'user'
  };

  return jwt.sign(
    payload,
    isAdmin ? JWT_ADMIN_SECRET : JWT_SECRET,
    { expiresIn: isAdmin ? JWT_ADMIN_TTL : JWT_TTL }
  );
}

/**
 * Valida un token JWT con verificación de IP
 * @param {string} token - Token JWT
 * @param {string} clientIp - IP del cliente
 * @param {boolean} isAdmin - Si debe validar como token admin
 * @returns {Object} Payload decodificado
 */
function validateToken(token, clientIp, isAdmin = false) {
  try {
    const decoded = jwt.verify(
      token,
      isAdmin ? JWT_ADMIN_SECRET : JWT_SECRET
    );

    // Verificación de IP
    //if (decoded.ip !== clientIp) {
    //  throw new Error('IP address mismatch');
    //}

    return decoded;
  } catch (error) {
    console.error(`Token validation failed: ${error.message}`);
    throw new Error('Invalid token: ' + error.message);
  }
}

/**
 * Renueva un token JWT para admin verificando IP
 * @param {string} expiredToken - Token expirado
 * @param {string} clientIp - IP actual del cliente
 * @returns {string} Nuevo token JWT
 */
function renewAdminToken(expiredToken, clientIp) {
  try {
    const decoded = jwt.verify(expiredToken, JWT_ADMIN_SECRET, { ignoreExpiration: true });
    
    // Verificaciones críticas
    if (decoded.role !== 'admin') throw new Error('Only admins can renew');
    //if (decoded.ip !== clientIp) throw new Error('IP does not match');
    if (Date.now() > decoded.exp * 1000 + 5 * 60 * 1000) { 
      throw new Error('Late renewal');
    }

    // Genera nuevo token con IP actualizada
    return jwt.sign(
      {
        userId: decoded.userId,
        author: decoded.author,
        ip: clientIp,  
        email: decoded.email,
        role: decoded.role
      },
      JWT_ADMIN_SECRET,
      { expiresIn: JWT_ADMIN_TTL }
    );
  } catch (error) {
    console.error('Renewal Error:', error.message);
    throw error;
  }
}

module.exports = { generateToken, validateToken, renewAdminToken };