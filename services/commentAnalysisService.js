const { getClientConfig } = require('./clientConfigService');
const generateCommentAnalysisPrompt = require('../config/commentAnalysisPromptConfig');

const GrokAnalysisProvider = require('../moderationProviders/GrokModerationProvider');
const OpenAIAnalysisProvider = require('../moderationProviders/OpenAIModerationProvider');
const GeminiAnalysisProvider = require('../moderationProviders/GeminiModerationProvider');
const DeepSeekAnalysisProvider = require('../moderationProviders/DeepSeekModerationProvider');


async function commentAnalysisService(cid, title, summary, comments, lastAnalysis = {}) {

    let clientConfig;

    try {
        // Fetch base configuration
        clientConfig = await getClientConfig(cid, 'moderation');
        if (!clientConfig || typeof clientConfig !== 'object') {
            throw new Error('Invalid or missing client configuration.');
        }

        // Validate required properties
        if (!clientConfig.hasOwnProperty('enabled') || !clientConfig.hasOwnProperty('provider')) {
            throw new Error('Incomplete client configuration: missing required properties (enabled, provider).');
        }

    } catch (error) {
        console.error(`Error getting client configuration. cid ${cid}:`, error.message);
        return { analysis: null, reason: 'Error getting client configuration.' };
    }

    if (!clientConfig.enabled) {
        return { analysis: null, reason: 'Comment analysis disabled.' };
    }

    // Select provider
    let provider;
    switch (clientConfig.provider) {
        case 'OpenAI':
            provider = new OpenAIAnalysisProvider(clientConfig.apiKey, clientConfig.configJson);
            break;
        case 'Grok':
            provider = new GrokAnalysisProvider(clientConfig.apiKey, clientConfig.configJson);
            break;
        case 'Gemini':
            provider = new GeminiAnalysisProvider(clientConfig.apiKey, clientConfig.configJson);
            break;
        case 'Deep':
            provider = new DeepSeekAnalysisProvider(clientConfig.apiKey, clientConfig.configJson);
            break;
        default:
            return { analysis: null, reason: `Provider not supported: ${clientConfig.provider}` };
    }

    // Prepare prompt using fixed configuration
    const prompt = generateCommentAnalysisPrompt(title, summary, comments, lastAnalysis = {});

    try {
        const result = await provider.analyze(prompt);
        return { analysis: JSON.parse(result), reason: null };
    } catch (error) {
        console.error(`Error analyzing with the provider ${clientConfig.provider}:`, error.message);
        return { analysis: null, reason: 'Error analyzing with the provider.' };
    }
}

module.exports = { commentAnalysisService };