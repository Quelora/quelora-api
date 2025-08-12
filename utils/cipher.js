// ./Utils/cipher.js
const crypto = require('crypto');

// Validar la clave de cifrado desde .env
function validateEncryptionKey(encryptionKey) {
  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY must be defined in .env file');
  }
  try {
    const keyBuffer = Buffer.from(encryptionKey, 'hex');
    if (keyBuffer.length !== 32) {
      throw new Error('ENCRYPTION_KEY must be a 64-character hexadecimal string representing 32 bytes');
    }
  } catch (err) {
    throw new Error('ENCRYPTION_KEY is not a valid hexadecimal string: ' + err.message);
  }
}

const IV_LENGTH = 16; // Longitud del vector de inicialización para AES

/**
 * Generates a consistent 64-character hex key from an input string
 * @param {string} inputString - The input string (e.g., "QU-MBZEB1RL-O8J6H")
 * @returns {string} 64-character hexadecimal key
 */
function generateKeyFromString(inputString) {
  if (!inputString || typeof inputString !== 'string') {
    throw new Error('Input must be a non-empty string');
  }

  // Use SHA-256 hash to get a consistent 32-byte value
  const hash = crypto.createHash('sha256');
  hash.update(inputString);
  const hashDigest = hash.digest('hex');

  // If we need exactly 64 chars, SHA-256 already provides that (32 bytes in hex)
  return hashDigest;
}

/**
 * Encrypts a JSON object into a string
 * @param {object} jsonObject - The JSON object to encrypt
 * @param {string} encryptionKey - The encryption key (hex string)
 * @returns {string} Encrypted string in format iv:encryptedData
 */
function encryptJSON(jsonObject, encryptionKey) {
  if (!jsonObject || typeof jsonObject !== 'object') {
    throw new Error('Input must be a valid JSON object');
  }
  
  const text = JSON.stringify(jsonObject);
  return encrypt(text, encryptionKey);
}

/**
 * Decrypts a string into a JSON object
 * @param {string} encryptedString - The encrypted string in format iv:encryptedData
 * @param {string} encryptionKey - The encryption key (hex string)
 * @returns {object} The decrypted JSON object
 */
function decryptJSON(encryptedString, encryptionKey) {
  const decryptedText = decrypt(encryptedString, encryptionKey);
  return JSON.parse(decryptedText);
}

// Función para cifrar un texto
function encrypt(text, encryptionKey) {
  if (!text || typeof text !== 'string') {
    throw new Error('Text to encrypt must be a non-empty string');
  }
  validateEncryptionKey(encryptionKey);
  
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(encryptionKey, 'hex'), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

// Función para descifrar un texto
function decrypt(text, encryptionKey) {
  if (!text || typeof text !== 'string') {
    throw new Error('Text to decrypt must be a non-empty string');
  }
  validateEncryptionKey(encryptionKey);
  
  const [iv, encryptedText] = text.split(':').map(part => Buffer.from(part, 'hex'));
  if (!iv || !encryptedText) {
    throw new Error('Invalid encrypted text format');
  }
  
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(encryptionKey, 'hex'), iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = {
  encrypt,
  decrypt,
  encryptJSON,
  decryptJSON,
  generateKeyFromString,
  validateEncryptionKey
};