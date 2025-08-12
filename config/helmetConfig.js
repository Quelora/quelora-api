// ./config/helmetConfig.js
const helmet = require('helmet');

module.exports = helmet({
  contentSecurityPolicy: false, // Deshabilitado, pero puedes configurarlo según tus necesidades
  frameguard: false, // Deshabilitado, pero puedes habilitarlo si necesitas protección contra clickjacking
  hsts: {
    maxAge: 31536000, // 1 año en segundos
    includeSubDomains: true,
    preload: true,
  },
  noSniff: true, // Previene que los navegadores interpreten archivos como un tipo MIME incorrecto
  referrerPolicy: { policy: 'no-referrer' }, // No envía información de referencia
  expectCt: {
    maxAge: 86400, // 1 día en segundos
    enforce: true,
  },
  crossOriginResourcePolicy: { policy: 'same-origin' }, // Solo permite solicitudes del mismo origen
  xssFilter: true, // Habilita el filtro XSS en los navegadores
  hidePoweredBy: true, // Oculta el encabezado 'X-Powered-By'
});