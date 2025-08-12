// ./services/languageService.js
require('dotenv').config();
const axios = require('axios');
const { DL_URL, DL_API_KEY } = process.env; 

async function detectLanguage(text) {
    const url = DL_URL;
    const apiKey = DL_API_KEY;
    
    try {
        const response = await axios.post(url, {
            q: text
        }, {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });
        const language = response?.data?.data?.detections[0]?.language;
        return language || 'unknown';
    } catch (error) {
        console.error('❌ Error detecting language:');
        return 'unknown';
    }
}

module.exports = { detectLanguage };