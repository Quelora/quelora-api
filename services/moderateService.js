// app/services/moderateService.js
const { getClientConfig } = require('./clientConfigService');
const generateModerationPrompt = require('../config/moderationPromptConfig');

const GrokModerationProvider = require('../moderationProviders/GrokModerationProvider');
const OpenAIModerationProvider = require('../moderationProviders/OpenAIModerationProvider');
const GeminiModerationProvider = require('../moderationProviders/GeminiModerationProvider');
const DeepSeekModerationProvider = require('../moderationProviders/DeepSeekModerationProvider');

async function moderateService(cid, text, config = null) {
    // Usar config proporcionado o buscar clientConfig
    let clientConfig = config;
    if (!config) {
        try {
            clientConfig = await getClientConfig(cid, 'moderation');
            if (!clientConfig || typeof clientConfig !== 'object') {
                throw new Error('Invalid or missing client configuration.');
            }
            // Validar propiedades requeridas
            if (!clientConfig.hasOwnProperty('enabled') || !clientConfig.hasOwnProperty('provider')) {
                throw new Error('Incomplete client configuration: missing required properties (enable, provider).');
            }
        } catch (error) {
            console.error(`Error getting client configuration. cid ${cid}:`, error.message);
            return { isRejected: null, reason: 'Error getting client configuration.' };
        }
    }

    // Verificar si la moderación está habilitada
    if (!clientConfig.enabled) {
        return { isRejected: null, reason: 'Moderation disabled.' };
    }

    // Seleccionar el proveedor según el campo 'provider'
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

    // Preparar el prompt
    let prompt = clientConfig.prompt || generateModerationPrompt(text);
    if (clientConfig.prompt) {
        prompt = clientConfig.prompt.replace(/\{text\}/g, text);
    }

    // Validar configJson si existe
    let parsedConfigJson = {};
    if (clientConfig.configJson) {
        try {
            parsedConfigJson = JSON.parse(clientConfig.configJson);
        } catch (error) {
            console.error(`Error parsing configJson for cid ${cid}:`, error.message);
            return { isRejected: null, reason: 'Error parsing configJson for cid (Invalid configJson).' };
        }
    }

    // Ejecutar la moderación usando el proveedor
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