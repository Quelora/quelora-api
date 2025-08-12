// ./middlewares/validateClientHeaderMiddleware.js
const { getClientConfig } = require('../services/clientConfigService');
const validateClientHeader = async  (req, res, next) => {
  const cid = req.headers['x-client-id'];
  
  if (!cid) {
    return res.status(400).json({ 
      error: 'Header X-Cliente-id is required' 
    });
  }
  
  const clientConfig = await getClientConfig(cid);
  if (!clientConfig) {
    return res.status(403).json({
      error: 'Invalid client ID'
    });
  }

  req.cid = cid;
  req.clientConfig = clientConfig;
  
  next();
};

module.exports = validateClientHeader;