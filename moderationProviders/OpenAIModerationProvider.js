// ./moderationProviders/OpenAIModerationProvider.js
const OpenAI = require('openai');
const ModerationProvider = require('./ModerationProvider');

class OpenAIModerationProvider extends ModerationProvider {
    constructor(apiKey, configJson) {
        super(apiKey, configJson);
        // Configuraciones por defecto (antes en .env)
        this.defaultConfig = {
            model: this.configJson.model || 'gpt-3.5-turbo',
            temperature: parseFloat(this.configJson.temperature || 0.7),
            max_tokens: parseInt(this.configJson.max_tokens || 5000, 10),
            max_retries: parseInt(this.configJson.max_retries || 3, 10),
            timeout: parseInt(this.configJson.timeout || 60000, 10)
        };

        // Validar que el apiKey esté presente
        if (!this.apiKey) {
            throw new Error('API Key es requerida para OpenAI.');
        }

        // Instanciar el cliente OpenAI
        this.openai = new OpenAI({
            apiKey: this.apiKey,
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
            throw new Error(`Error en la moderación de OpenAI: ${error.message}`);
        }
    }
}

module.exports = OpenAIModerationProvider;