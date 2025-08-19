// ./moderationProviders/ModerationProvider.js

class ModerationProvider {
    constructor(apiKey, configJson) {
        this.apiKey = apiKey;
        this.configJson = typeof configJson === 'string' ? JSON.parse(configJson) : configJson || {};
    }

    // Método que deben implementar todos los proveedores
    async moderate(prompt) {
        throw new Error('The moderate method must be implemented by the provider.');
    }

    // moderate alias
    async analyze(prompt) {
        return await this.moderate(prompt);
    }
}

module.exports = ModerationProvider;