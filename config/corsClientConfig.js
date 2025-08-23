// ./config/corsClientConfig.js
const clientConfigService  = require('../services/clientConfigService');

async function clientCorsConfig(req, callback) {
  try {
    const cid = req.headers['x-client-id'];

    // Si no hay CID, dejamos que pase al siguiente middleware CORS
    if (!cid) {
      return callback(null, { origin: false });
    }

    const clientConfig = await clientConfigService.getClientConfig(cid);
  
    if (!clientConfig?.cors?.enabled) {
      return callback(null, { origin: false });
    }
 
    const corsOptions = {
      origin: clientConfig.cors.allowedOrigins,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Id', 'X-Ip', 'X-Country', 'X-Region', 'X-City','X-Captcha-Token'],
      credentials: true,
      maxAge: 86400 // 24 horas
    };

    callback(null, corsOptions);
  } catch (error) {
    console.error('Error in client CORS config:', error);
    callback(null, { origin: false }); // Denegar por defecto en caso de error
  }
}

module.exports = clientCorsConfig;