// ./controllers/ssoController.js
const { ssoService } = require('../services/ssoService');

/**
 * Handles SSO verification requests from identity providers
 * @param {Object} req - Express request object (expects req.cid and req.body.credential)
 * @param {Object} res - Express response object
 */
exports.ssoVerify = async (req, res) => {
    if (!req.body?.credential) {
        return res.status(400).json({  status: 'error',  message: 'Missing credential parameter' });
    }

    const { credential, provider } = req.body;
    const cid = req.headers['x-client-id'];
    if (!cid) {
      return res.status(400).json({ error: 'X-Client-Id header is required' });
    }
    try {
        const result = await ssoService(cid, provider, credential);

        if (result.status === 'success') {
            return res.json({ status: 'success', token: result.token, expires_in: result.expires_in });
        }

        return res.status(401).json({ status: 'error', message: result.message || 'SSO verification failed' });

    } catch (error) {
        return res.status(500).json({ status: 'error', message: 'Internal authentication error' });
    }
};