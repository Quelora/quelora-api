require('dotenv').config();
const { getClientConfig } = require('./clientConfigService');
const GoogleProvider = require('../ssoProviders/GoogleProvider');
const XProvider = require('../ssoProviders/XProvider');
const FacebookProvider = require('../ssoProviders/FacebookProvider');
const AppleProvider = require('../ssoProviders/AppleProvider');
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
    let provider;
    try {
        const commonConfig = {
            jwtSecretKey: clientConfig.jwtSecretCipher || process.env.JWT_SECRET,
            baseURL: clientConfig.baseUrl,
            jwtTimeToLive: (parseInt(process.env.JWT_TTL, 10) || 72) * 3600 
        };

        switch (providerName) {
            case 'google':
                provider = new GoogleProvider({
                    ...clientConfig.providerDetails.Google,
                    ...commonConfig
                });
                break;
            case 'quelora':
                // provider = new QueloraProvider({ ...clientConfig.providerDetails.Quelora, ...commonConfig });
                return { status: 'error', message: 'Quelora provider not implemented' };
            case 'facebook':
                provider = new FacebookProvider({
                    ...clientConfig.providerDetails.Facebook,
                    ...commonConfig
                });
                break;
            case 'apple':
                provider = new AppleProvider({
                    ...clientConfig.providerDetails.Apple,
                    ...commonConfig
                });
                break;
            case 'x':
                provider = new XProvider({
                    ...clientConfig.providerDetails.X,
                    ...commonConfig
                });
                break;
            default:
                return { status: 'error', message: `Provider not supported: ${providerName || 'unknown'}` };
        }
    } catch (error) {
        console.error(`Error initializing provider ${providerName}:`, error.message);
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