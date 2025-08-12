const { getClientConfig } = require('./clientConfigService');
const GoogleProvider = require('../ssoProviders/GoogleProvider');
const XProvider = require('../ssoProviders/XProvider');
// const FacebookProvider = require('../ssoProviders/FacebookProvider');
// const AppleProvider = require('../ssoProviders/AppleProvider');
// const QueloraProvider = require('../ssoProviders/QueloraProvider');

async function ssoService(cid, providerName, credential) {
    if (!credential) {
        return { status: 'error', message: 'Missing credential parameter' };
    }
    // Fetch clientConfig
    let clientConfig;
    try {
        clientConfig = await getClientConfig(cid, 'login');
        if (!clientConfig || typeof clientConfig !== 'object') {
            throw new Error('Invalid or missing login configuration.');
        }
    } catch (error) {
        console.error(`Error getting client configuration. cid ${cid}:`, error.message);
        return { status: 'error', message: 'Error getting client configuration.' };
    }

    // Select provider using switch
    try {
        switch (providerName) {
            case 'google':
                const googleConfig = {
                    googleClientId: clientConfig.providerDetails.Google.clientId,
                    jwtSecretKey: 'kzUf4sxss4AeG5uHkNZAqT1Nyi1zVfpz',
                    baseURL: clientConfig.baseUrl,
                    jwtTimeToLive: 3600 * 24
                };
                provider = new GoogleProvider(googleConfig);
                break;
            case 'quelora':
                // provider = new QueloraProvider(clientConfig.providerDetails.Quelora);
                return { status: 'error', message: 'Quelora provider not implemented' };
            case 'facebook':
                // provider = new FacebookProvider(clientConfig.providerDetails.Facebook);
                return { status: 'error', message: 'Facebook provider not implemented' };
            case 'aApple':
                // provider = new AppleProvider(clientConfig.providerDetails.Apple);
                return { status: 'error', message: 'Apple provider not implemented' };
            case 'x':
                provider = new xProvider(clientConfig.providerDetails.x);
                return { status: 'error', message: 'X provider not implemented' };
            default:
                return { status: 'error', message: `Provider not supported: ${providerName || 'unknown'}` };
        }
    } catch (error) {
        console.error(`Error initializing provider ${provider}:`, error.message);
        return { status: 'error', message: `Error initializing provider ${providerName}` };
    }

    // Verify credential
    try {
        const result = await provider.verify(credential);
        return result;
    } catch (error) {
        console.error(`Error with SSO provider ${providerName}:`, error.message);
        return { status: 'error', message: 'Error during SSO verification.' };
    }
}

module.exports = { ssoService };