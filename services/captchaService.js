const axios = require('axios');
const qs = require('qs');

/**
 * @class CaptchaVerificationService
 * Service to verify CAPTCHA tokens for Turnstile and reCAPTCHA providers.
 * All configuration variables are passed explicitly instead of being read from environment variables.
 * For reCAPTCHA, credentials are provided as a JSON string and parsed directly.
 */
class CaptchaVerificationService {
    /**
     * Verifies a CAPTCHA token with the specified provider.
     * @param {string} provider - The CAPTCHA provider ('turnstile' or 'recaptcha').
     * @param {string} token - The CAPTCHA token sent from the frontend.
     * @param {Object} config - Configuration object containing provider-specific settings.
     * @param {string} [config.secretKey] - Secret key for Turnstile verification.
     * @param {string} [config.projectID] - Google Cloud project ID for reCAPTCHA.
     * @param {string} [config.recaptchaKey] - reCAPTCHA site key.
     * @param {string} [config.credentialsPath] - JSON string containing Google Cloud credentials for reCAPTCHA.
     * @param {string} [ip] - The client’s IP address (optional, for Turnstile).
     * @returns {Promise<{ success: boolean, error?: string, score?: number, reasons?: string[], securityLevel?: string, action?: string }>} Verification result.
     * @throws {Error} If provider or token is missing or unsupported.
     */
    static async verifyToken(provider, token, config, ip = null) {
        // Validate required parameters
        if (!provider || !token) {
            throw new Error('Provider and token are required.');
        }

        // Validate supported CAPTCHA provider
        if (!['turnstile', 'recaptcha'].includes(provider)) {
            throw new Error(`Unsupported CAPTCHA provider: ${provider}`);
        }

        try {
            // Route to appropriate verification method based on provider
            if (provider === 'turnstile') {
                return await this._verifyTurnstileToken(token, config.secretKey, ip);
            } else if (provider === 'recaptcha') {
                return await this._verifyRecaptchaToken(token, config.projectID, config.recaptchaKey, config.credentialsPath);
            }
        } catch (error) {
            console.error(`Error verifying ${provider} token:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Verifies a Cloudflare Turnstile token.
     * @param {string} token - The Turnstile token to verify.
     * @param {string} secretKey - The Turnstile secret key.
     * @param {string} [ip] - The client’s IP address (optional).
     * @returns {Promise<{ success: boolean, error?: string }>} Verification result.
     * @throws {Error} If secretKey is not provided.
     */
    static async _verifyTurnstileToken(token, secretKey, ip) {
        // Validate secret key presence
        if (!secretKey) {
            throw new Error('Turnstile secret key is required.');
        }

        // Make HTTP POST request to Cloudflare Turnstile verification endpoint
        const response = await axios.post(
            'https://challenges.cloudflare.com/turnstile/v0/siteverify',
            qs.stringify({
                secret: secretKey,
                response: token,
                ...(ip && { remoteip: ip }),
            }),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            }
        );

        const { success, 'error-codes': errorCodes } = response.data;
        // Check if verification was successful
        if (!success) {
            return { success: false, error: errorCodes ? errorCodes.join(', ') : 'Turnstile verification failed' };
        }

        return { success: true };
    }

    /**
     * Verifies a Google reCAPTCHA Enterprise token.
     * Credentials are provided as a JSON string and parsed directly.
     * @param {string} token - The reCAPTCHA Enterprise token to verify.
     * @param {string} [projectID] - Google Cloud project ID (optional, can be derived from credentials).
     * @param {string} recaptchaKey - reCAPTCHA site key.
     * @param {string} credentialsJson - JSON string containing Google Cloud credentials.
     * @param {string} [action] - The expected action for the token (optional).
     * @returns {Promise<{ success: boolean, score?: number, error?: string, reasons?: string[], securityLevel?: string, action?: string }>} Verification result.
     */
    static async _verifyRecaptchaToken(token, projectID, recaptchaKey, credentialsJson, action = null) {
        try {
            // Validate required configuration parameters
            if (!recaptchaKey) {
                console.warn('reCAPTCHA skipped: missing recaptchaKey');
                return { 
                    success: false, 
                    error: 'reCAPTCHA not configured',
                };
            }

            // Validate credentials JSON presence
            if (!credentialsJson) {
                console.error('reCAPTCHA credentials JSON missing');
                return { 
                    success: false, 
                    error: 'reCAPTCHA credentials JSON not provided',
                };
            }

            // Parse credentials JSON
            let credentials;
            try {
                credentials = JSON.parse(credentialsJson);
            } catch (parseError) {
                console.error('Failed to parse reCAPTCHA credentials JSON:', parseError.message);
                return { 
                    success: false, 
                    error: 'Invalid reCAPTCHA credentials JSON format',
                };
            }

            // Derive projectID from credentials if not provided
            const derivedProjectID = projectID || credentials.project_id;
            if (!derivedProjectID) {
                console.error('reCAPTCHA project ID missing in both config and credentials JSON');
                return { 
                    success: false, 
                    error: 'reCAPTCHA project ID not provided',
                };
            }

            // Dynamically import reCAPTCHA client to avoid loading unless needed
            const { RecaptchaEnterpriseServiceClient } = await import('@google-cloud/recaptcha-enterprise');

            let client;
            try {
                // Initialize reCAPTCHA client with parsed credentials
                client = new RecaptchaEnterpriseServiceClient({
                    credentials: credentials
                });
            } catch (initError) {
                console.error('reCAPTCHA client initialization failed:', initError.message);
                return { 
                    success: false, 
                    error: 'reCAPTCHA client failed to initialize',
                };
            }

            // Construct project path for API request
            const projectPath = client.projectPath(derivedProjectID);
            const request = {
                assessment: {
                    event: {
                        token,
                        siteKey: recaptchaKey,
                    },
                },
                parent: projectPath,
            };

            let response;
            try {
                // Create reCAPTCHA assessment
                [response] = await client.createAssessment(request);
            } catch (apiError) {
                console.error('reCAPTCHA API call failed:', apiError.message);
                return { 
                    success: false, 
                    error: 'reCAPTCHA API error',
                };
            }

            // Validate token properties
            if (!response?.tokenProperties?.valid) {
                console.warn('reCAPTCHA token invalid:', response?.tokenProperties?.invalidReason);
                return {
                    success: false,
                    error: response?.tokenProperties?.invalidReason || 'Invalid token',
                };
            }

            // Validate action if provided
            if (action && response.tokenProperties.action !== action) {
                console.warn('reCAPTCHA action mismatch');
                return {
                    success: false,
                    error: 'Action mismatch',
                };
            }

            // Extract risk analysis details
            const score = response.riskAnalysis.score;
            const reasons = response.riskAnalysis.reasons;

            // Define security thresholds for risk analysis
            const SECURITY_THRESHOLDS = {
                HIGH_RISK: 0.3,
                MEDIUM_RISK: 0.5,
                LOW_RISK: 0.7 
            };

            let shouldAbort = false;
            let securityLevel = 'low';
            
            // Evaluate risk score and determine action
            if (score < SECURITY_THRESHOLDS.HIGH_RISK) {
                shouldAbort = true;
                securityLevel = 'high_risk';
                console.warn(`🚨 HIGH RISK detected (score: ${score}). Aborting operation.`);
            } else if (score < SECURITY_THRESHOLDS.MEDIUM_RISK) {
                shouldAbort = false;
                securityLevel = 'medium_risk';
                console.warn(`⚠️ MEDIUM RISK detected (score: ${score}). Additional verification required.`);
            } else if (score < SECURITY_THRESHOLDS.LOW_RISK) {
                shouldAbort = false;
                securityLevel = 'low_risk';
                console.log(`✅ LOW RISK detected (score: ${score}). Proceeding normally.`);
            } else {
                shouldAbort = false;
                securityLevel = 'very_low_risk';
                console.log(`✅ VERY LOW RISK detected (score: ${score}). Proceeding without restrictions.`);
            }

            // Return verification result with risk details
            return {
                success: !shouldAbort,
                score: score,
                reasons: reasons,
                securityLevel: securityLevel,
                action: response.tokenProperties.action
            };

        } catch (unexpectedError) {
            console.error('Unexpected reCAPTCHA verification error:', unexpectedError.message);
            return { 
                success: false, 
                error: 'Unexpected error during reCAPTCHA verification',
                shouldAbort: true
            };
        }
    }
}

module.exports = CaptchaVerificationService;