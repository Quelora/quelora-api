// app/services/moderateService.js
const { getClientConfig } = require('./clientConfigService');
const generateModerationPrompt = require('../config/moderationPromptConfig');

const GrokModerationProvider = require('../moderationProviders/GrokModerationProvider');
const OpenAIModerationProvider = require('../moderationProviders/OpenAIModerationProvider');
const GeminiModerationProvider = require('../moderationProviders/GeminiModerationProvider');
const DeepSeekModerationProvider = require('../moderationProviders/DeepSeekModerationProvider');

async function moderateService(cid, text, config = null) {
    let clientConfig;

    try {
        // Traer configuración base
        clientConfig = await getClientConfig(cid, 'moderation');
        if (!clientConfig || typeof clientConfig !== 'object') {
            throw new Error('Invalid or missing client configuration.');
        }

        // Validar propiedades básicas
        if (!clientConfig.hasOwnProperty('enabled') || !clientConfig.hasOwnProperty('provider')) {
            throw new Error('Incomplete client configuration: missing required properties (enabled, provider).');
        }

        // Si me pasaron config como objeto (ya parseado), lo asigno a configJson
        if (config && typeof config === 'object') {
            clientConfig.configJson = JSON.stringify(config);
        }

    } catch (error) {
        console.error(`Error getting client configuration. cid ${cid}:`, error.message);
        return { isRejected: null, reason: 'Error getting client configuration.' };
    }

    if (!clientConfig.enabled) {
        return { isRejected: null, reason: 'Moderation disabled.' };
    }

    // Seleccionar proveedor
    let provider;
    switch (clientConfig.provider) {
        case 'OpenAI':
            provider = new OpenAIModerationProvider(clientConfig.apiKey, clientConfig.configJson);
            break;
        case 'Grok':
            provider = new GrokModerationProvider(clientConfig.apiKey, clientConfig.configJson);
            break;
        case 'Gemini':
            provider = new GeminiModerationProvider(clientConfig.apiKey, clientConfig.configJson);
            break;
        case 'Deep':
            provider = new DeepSeekModerationProvider(clientConfig.apiKey, clientConfig.configJson);
            break;
        default:
            return { isRejected: null, reason: `Provider not supported: ${clientConfig.provider}` };
    }

    // Preparar prompt
    let prompt = clientConfig.prompt || generateModerationPrompt(text);
    if (clientConfig.prompt) {
        prompt = clientConfig.prompt.replace(/\{text\}/g, text);
    }

    try {
        const result = await provider.moderate(prompt);
        const isRejected = result.includes('Comment Rejected');
        return { isRejected, reason: result };
    } catch (error) {
        console.error(`Error moderating with the provider ${clientConfig.provider}:`, error.message);
        return { isRejected: null, reason: 'Error moderating with the provider.' };
    }
}

module.exports = { moderateService };