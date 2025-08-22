// ./services/translateService.js
require('dotenv').config();
const axios = require('axios');
const { TRANSLATE_DETECT_API_URL, TRANSLATE_API_URL, TRANSLATE_API_KEY } = process.env;
const { decodeHtmlEntities } = require('../utils/textUtils');
/**
 * Detecta el idioma de un texto.
 * @param {string} text - Texto para detectar el idioma.
 * @returns {Promise<string>} - Código del idioma detectado (ej. "es", "en").
 */
const googleDetectLanguage = async (text) => {
  try {
    const response = await axios.post(
      TRANSLATE_DETECT_API_URL,
      {
        q: text,
      },
      {
        params: {
          key: TRANSLATE_API_KEY,
        },
      }
    );

    return response.data.data.detections[0][0].language;
  } catch (error) {
    console.error('❌ Error detecting language:', error.message);
    throw error;
  }
};

/**
 * Traduce un texto automáticamente sin especificar el idioma de origen.
 * @param {string} text - Texto a traducir.
 * @param {string} targetLanguage - Código del idioma de destino (ej. "en").
 * @returns {Promise<string>} - Texto traducido.
 */
const translateService = async (text, targetLanguage) => {
  try {
    const response = await axios.post(
      TRANSLATE_API_URL,
      {
        q: text,
        target: targetLanguage,
      },
      {
        params: {
          key: TRANSLATE_API_KEY,
        },
      }
    );

    const translatedText = response.data.data.translations[0].translatedText;
    return decodeHtmlEntities(translatedText);
  } catch (error) {
    console.error('❌ Error translating the text:', error.message);
    throw error;
  }
};

module.exports = {
  googleDetectLanguage,
  translateService,
};