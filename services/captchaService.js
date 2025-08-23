// app/services/captchaService.js
const axios = require('axios');
const qs = require('qs');
const fs = require('fs');
const path = require('path');

const { RecaptchaEnterpriseServiceClient } = require('@google-cloud/recaptcha-enterprise');

/**
 * @class CaptchaVerificationService
 * Service to verify CAPTCHA tokens for Turnstile and reCAPTCHA providers.
 */
class CaptchaVerificationService {
    /**
     * Verifies a CAPTCHA token with the specified provider.
     * @param {string} provider - The CAPTCHA provider ('turnstile' or 'recaptcha').
     * @param {string} token - The CAPTCHA token sent from the frontend.
     * @param {string} [ip] - The client’s IP address (optional, for Turnstile).
     * @returns {Promise<{ success: boolean, error?: string }>} Verification result.
     */
    static async verifyToken(provider, token, ip = null) {
        if (!provider || !token) {
            throw new Error('Provider and token are required.');
        }

        if (!['turnstile', 'recaptcha'].includes(provider)) {
            throw new Error(`Unsupported CAPTCHA provider: ${provider}`);
        }

        try {
            if (provider === 'turnstile') {
                return await this._verifyTurnstileToken(token, ip);
            } else if (provider === 'recaptcha') {
                return await this._verifyRecaptchaToken(token);
            }
        } catch (error) {
            console.error(`Error verifying ${provider} token:`, error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Verifies a Cloudflare Turnstile token.
     * @param {string} token - The Turnstile token.
     * @param {string} [ip] - The client’s IP address (optional).
     * @returns {Promise<{ success: boolean, error?: string }>}
     */
    static async _verifyTurnstileToken(token, ip) {
        const secretKey = process.env.TURNSTILE_SECRET_KEY;
        if (!secretKey) {
            throw new Error('TURNSTILE_SECRET_KEY is not set in environment variables.');
        }

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
        if (!success) {
            return { success: false, error: errorCodes ? errorCodes.join(', ') : 'Turnstile verification failed' };
        }

        return { success: true };
    }

     /**
     * Verifies a Google reCAPTCHA Enterprise token.
     * @param {string} token - The reCAPTCHA Enterprise token.
     * @param {string} [action] - The expected action for the token (optional).
     * @returns {Promise<{ success: boolean, score?: number, error?: string }>}
     */
    static async _verifyRecaptchaToken(token, action = null) {
        try {
            const projectID = process.env.GOOGLE_CLOUD_PROJECT_ID;
            const recaptchaKey = process.env.RECAPTCHA_SITE_KEY;
            const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

            if (!projectID || !recaptchaKey) {
                console.warn('reCAPTCHA skipped: missing GOOGLE_CLOUD_PROJECT_ID or RECAPTCHA_SITE_KEY');
                return { 
                    success: false, 
                    error: 'reCAPTCHA not configured',
                };
            }

            if (!fs.existsSync(credentialsPath)) {
                console.error('reCAPTCHA credentials file missing:', credentialsPath);
                return { 
                    success: false, 
                    error: 'reCAPTCHA credentials file not found',
                };
            }
            
            let client;
            try {
                client = new RecaptchaEnterpriseServiceClient();
            } catch (initError) {
                console.error('reCAPTCHA client initialization failed:', initError.message);
                return { 
                    success: false, 
                    error: 'reCAPTCHA client failed to initialize',
                };
            }

            const projectPath = client.projectPath(projectID);
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
                [response] = await client.createAssessment(request);
            } catch (apiError) {
                console.error('reCAPTCHA API call failed:', apiError.message);
                return { 
                    success: false, 
                    error: 'reCAPTCHA API error',
                };
            }

            if (!response?.tokenProperties?.valid) {
                console.warn('reCAPTCHA token invalid:', response?.tokenProperties?.invalidReason);
                return {
                    success: false,
                    error: response?.tokenProperties?.invalidReason || 'Invalid token',
                };
            }

            if (action && response.tokenProperties.action !== action) {
                console.warn('reCAPTCHA action mismatch');
                return {
                    success: false,
                    error: 'Action mismatch',
                };
            }

            const score = response.riskAnalysis.score;
            const reasons = response.riskAnalysis.reasons;

            const SECURITY_THRESHOLDS = {
                HIGH_RISK: 0.3,
                MEDIUM_RISK: 0.5,
                LOW_RISK: 0.7 
            };

            let shouldAbort = false;
            let securityLevel = 'low';
            
            if (score < SECURITY_THRESHOLDS.HIGH_RISK) {
                shouldAbort = true;
                securityLevel = 'high_risk';
                console.warn(`🚨 HIGH RISK detected (score: ${score}). Aborting operation.`);
            } else if (score < SECURITY_THRESHOLDS.MEDIUM_RISK) {
                shouldAbort = false; // No abortar, pero requerir verificación extra
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

            return {
                success: shouldAbort,
                score: score,
                reasons: reasons,
                securityLevel: securityLevel, // ⬅️ NIVEL DE RIESGO
                action: response.tokenProperties.action
            };

        } catch (unexpectedError) {
            console.error('Unexpected reCAPTCHA verification error:', unexpectedError.message);
            return { 
                success: false, 
                error: 'Unexpected error during reCAPTCHA verification',
                shouldAbort: true // ⬅️ Abortar por error inesperado
            };
        }
    }
}

module.exports = CaptchaVerificationService;