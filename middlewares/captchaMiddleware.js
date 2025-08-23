// middlewares/captchaMiddleware.js
const CaptchaVerificationService = require('../services/captchaService');

/**
 * Middleware to verify CAPTCHA tokens for incoming requests.
 * Expects 'x-captcha-token' in the request headers and optionally 'x-real-ip' or 'x-ip'.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
async function captchaMiddleware(req, res, next) {
  const captchaToken = req.headers['x-captcha-token'];
  const ip = req.headers['x-real-ip'] || req.headers['x-ip'];

  // Check if CAPTCHA token is provided
  if (!captchaToken) {
    return res.status(400).json({ message: 'CAPTCHA token is required' });
  }

  try {
    // Verify the CAPTCHA token using the CaptchaVerificationService
    const isValid = await CaptchaVerificationService.verifyToken('turnstile', captchaToken, ip);

    // Check if verification was successful
    if (!isValid.success) {
      return res.status(401).json({
        message: 'CAPTCHA verification failed',
        error: isValid.error || 'Invalid CAPTCHA token',
      });
    }

    // If verification is successful, proceed to the next middleware
    next();
  } catch (error) {
    console.error('CAPTCHA middleware error:', error.message);
    return res.status(500).json({ message: 'Internal server error during CAPTCHA verification' });
  }
}

module.exports = captchaMiddleware;