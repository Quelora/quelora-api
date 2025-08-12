const { GoogleGenerativeAI } = require('@google/generative-ai');
const ModerationProvider = require('./ModerationProvider');

class GeminiModerationProvider extends ModerationProvider {
    constructor(apiKey, configJson) {
        super(apiKey, configJson);
        // Configuraciones por defecto para Gemini
        this.defaultConfig = {
            model: this.configJson.model || 'gemini-1.5-pro', // Modelo por defecto
            temperature: parseFloat(this.configJson.temperature || 0.7),
            maxOutputTokens: parseInt(this.configJson.maxOutputTokens || 1000, 10),
            topP: parseFloat(this.configJson.topP || 0.9),
            topK: parseInt(this.configJson.topK || 40, 10)
        };

        // Validar que el apiKey esté presente
        if (!this.apiKey) {
            throw new Error('API Key es requerida para Gemini.');
        }

        // Instanciar el cliente Gemini
        this.gemini = new GoogleGenerativeAI(this.apiKey);
    }

    async moderate(prompt) {
        const model = this.gemini.getGenerativeModel({
            model: this.defaultConfig.model,
            generationConfig: {
                temperature: this.defaultConfig.temperature,
                maxOutputTokens: this.defaultConfig.maxOutputTokens,
                topP: this.defaultConfig.topP,
                topK: this.defaultConfig.topK
            }
        });

        try {
            const response = await model.generateContent(prompt);
            return response.response.text();
        } catch (error) {
            throw new Error(`Error en la moderación de Gemini: ${error.message}`);
        }
    }
}

module.exports = GeminiModerationProvider;