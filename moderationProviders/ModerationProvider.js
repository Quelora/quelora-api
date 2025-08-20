// ./moderationProviders/ModerationProvider.js

class ModerationProvider {
    constructor(apiKey, configJson) {
        this.apiKey = apiKey;
        try {
            this.configJson = typeof configJson === 'string' && configJson.trim() ? JSON.parse(configJson) : configJson || {};
        } catch (error) {
            console.error('Error parsing configJson:', error.message);
            this.configJson = {};
        }
    }

    async moderate(prompt) {
        throw new Error('The moderate method must be implemented by the provider.');
    }

    async analyze(prompt) {
        return await this.moderate(prompt);
    }
}

module.exports = ModerationProvider;