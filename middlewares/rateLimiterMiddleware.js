// ./middlewares/rateLimiterMiddleware.js
const rateLimit = require('express-rate-limit');

// Límite global: Máximo 5 solicitudes por minuto
const globalRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 60, // Límite de 60 solicitudes por IP
    message: 'Too many requests. Please try again later [Global].',
    headers: true,
  });
  
// Límite estricto: Máximo 1 solicitud cada 2 segundos
const strictRateLimiter = rateLimit({
    windowMs: 2 * 1000, // 2 segundos
    max: 8, // Límite de 1 solicitud por IP
    message: 'Too many requests. Please slow down [Strict].',
    headers: true,
});

module.exports = { globalRateLimiter, strictRateLimiter };