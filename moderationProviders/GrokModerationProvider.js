const OpenAI = require('openai');
const ModerationProvider = require('./ModerationProvider');

class GrokModerationProvider extends ModerationProvider {
    constructor(apiKey, configJson) {
        super(apiKey, configJson);
        // Configuraciones por defecto para Grok
        this.defaultConfig = {
            model: this.configJson.model || 'grok-3-beta', // Modelo por defecto
            temperature: parseFloat(this.configJson.temperature || 0.7),
            max_tokens: parseInt(this.configJson.max_tokens || 1000, 10),
            max_retries: parseInt(this.configJson.max_retries || 3, 10),
            timeout: parseInt(this.configJson.timeout || 30000, 10)
        };

        // Validar que el apiKey esté presente
        if (!this.apiKey) {
            throw new Error('API Key es requerida para Grok.');
        }

        // Instanciar el cliente OpenAI con la URL base de xAI
        this.openai = new OpenAI({
            apiKey: this.apiKey,
            baseURL: 'https://api.x.ai/v1',
            maxRetries: this.defaultConfig.max_retries,
            timeout: this.defaultConfig.timeout
        });
    }

    async moderate(prompt) {
        const chatBotParams = {
            messages: [{ role: 'user', content: prompt }],
            model: this.defaultConfig.model,
            temperature: this.defaultConfig.temperature,
            max_tokens: this.defaultConfig.max_tokens
        };

        try {
            const response = await this.openai.chat.completions.create(chatBotParams);
            return response.choices[0].message.content;
        } catch (error) {
            throw new Error(`Error en la moderación de Grok: ${error.message}`);
        }
    }
}

module.exports = GrokModerationProvider;