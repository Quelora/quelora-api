const fs = require('fs').promises;
const path = require('path');
const { toUnicodeBold } = require('../utils/textUtils');

// In-memory cache for loaded translations
const translationCache = {};

/**
 * Loads translation file for a given locale
 * @param {string} locale - Language code (e.g., 'es', 'en')
 * @returns {Promise<Object>} Translation dictionary
 */
async function loadTranslation(locale) {
  if (translationCache[locale]) {
    return translationCache[locale];
  }

  try {
    const filePath = path.join(__dirname, '../locale', `${locale}.json`);
    const data = await fs.readFile(filePath, 'utf8');
    const translations = JSON.parse(data);
    translationCache[locale] = translations;
    return translations;
  } catch (error) {
    console.error(`Failed to load translation for ${locale}: ${error.message}`);
    return {};
  }
}

/**
 * Translates a message using the locale's translation file with variable replacement
 * @param {string} message - Message key to translate
 * @param {string} locale - Language code (e.g., 'es', 'en')
 * @param {Object} [variables] - Key-value pairs for variable replacement (e.g., { name: 'John' })
 * @returns {Promise<string>} Translated message with variables replaced or original message if not found
 */
async function getLocalizedMessage(message, locale, variables = {}) {
  if (!message || !locale) return message || '';

  // Cargar traducciones (según tu función loadTranslation)
  const translations = await loadTranslation(locale);
  let translated = message;

  // Buscar mensaje en las traducciones (ejemplo: 'like.message')
  const keyParts = message.split('.');
  let current = translations;
  for (const part of keyParts) {
    current = current?.[part];
    if (!current) break;
  }
  translated = current || message;

  // Procesar {variable|bold}
  translated = translated.replace(
    /\{(\w+)\|bold\}/g, 
    (match, varName) => {
      const value = variables[varName] || '';
      return toUnicodeBold(value);
    }
  );

  // Reemplazo normal para {variable}
  for (const [key, value] of Object.entries(variables)) {
    translated = translated.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }

  return translated;
}

module.exports = { getLocalizedMessage };