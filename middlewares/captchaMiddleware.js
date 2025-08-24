const CaptchaVerificationService = require('../services/captchaService');

/**
 * Middleware to verify CAPTCHA tokens for incoming requests.
 * Expects 'x-captcha-token' in the request headers and optionally 'x-real-ip' or 'x-ip'.
 * Configuration variables (provider, secretKey, projectID, siteKey, credentialsJson) are passed from req.clientConfig.
 * If projectID is not provided in clientConfig, it is extracted from the credentialsJson.
 * @param {Object} req - Express request object containing headers and clientConfig.
 * @param {Object} res - Express response object.
 * @param {Function} next - Express next middleware function.
 * @returns {Promise<void>} Proceeds to next middleware if verification succeeds, or sends error response.
 */
async function captchaMiddleware(req, res, next) {
    const captchaToken = req.headers['x-captcha-token'];
    const ip = req.headers['x-real-ip'] || req.headers['x-ip'];

    if (!req.clientConfig?.captcha?.enabled) {
        return next();
    }

    const { provider, secretKey, projectID, siteKey, credentialsJson } = req.clientConfig.captcha;

    if (!captchaToken) {
        return res.status(400).json({ message: 'CAPTCHA token is required' });
    }

    if (!provider) {
        return res.status(400).json({ message: 'CAPTCHA provider is required' });
    }

    try {
        let config = {};

        if (provider === 'recaptcha') {
            // Derive projectID from credentialsJson if not provided
            let derivedProjectID = projectID;
            if (!derivedProjectID && credentialsJson) {
                try {
                    const credentials = JSON.parse(credentialsJson);
                    derivedProjectID = credentials.project_id;

                    if (!derivedProjectID) {
                        throw new Error('project_id not found in credentials JSON');
                    }
                } catch (parseError) {
                    console.error('Failed to parse credentials JSON:', parseError.message);
                    return res.status(500).json({ message: 'Invalid credentials JSON format' });
                }
            }

            config = {
                projectID: derivedProjectID,
                recaptchaKey: siteKey,
                credentialsPath: credentialsJson,
            };
        } else if (provider === 'turnstile') {
            config = { secretKey };
        }

        const verificationResult = await CaptchaVerificationService.verifyToken(
            provider,
            captchaToken,
            config,
            ip
        );

        if (!verificationResult.success) {
            return res.status(401).json({
                message: 'CAPTCHA verification failed',
                error: verificationResult.error || 'Invalid CAPTCHA token',
            });
        }

        next();
    } catch (error) {
        console.error('CAPTCHA middleware error:', error.message);
        return res.status(500).json({ message: 'Internal server error during CAPTCHA verification' });
    }
}


module.exports = captchaMiddleware;