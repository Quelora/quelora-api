// ./moderationProviders/ModerationProvider.js

class ModerationProvider {
    constructor(apiKey, configJson) {
        this.apiKey = apiKey;
        this.configJson = configJson ? JSON.parse(configJson) : {};
    }

    // Método que deben implementar todos los proveedores
    async moderate(prompt) {
        throw new Error('The moderate method must be implemented by the provider.');
    }
}

module.exports = ModerationProvider;