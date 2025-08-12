// ./services/toxicityService.js
require('dotenv').config();
const axios = require('axios');
const { PERSPECTIVE_API_URL, PERSPECTIVE_API_KEY, TOXICITY_THRESHOLD } = process.env; // Asegúrate de definir JWT_SECRET en tus variables de entorno

/*
 * Analiza la toxicidad de un comentario utilizando la API de Perspective
 * @param {string} text - Texto del comentario a analizar
 * @returns {Promise<number>} - Devuelve un valor de 0 a 1 indicando el nivel de toxicidad
 */
async function toxicityService(text, language = 'es', attributes = { TOXICITY: {}, SEVERE_TOXICITY: {}, INSULT: {}, PROFANITY: {}, IDENTITY_ATTACK: {}, THREAT: {} }) {
    try {
      const response = await axios.post(`${PERSPECTIVE_API_URL}?key=${PERSPECTIVE_API_KEY}`, {
        comment: { text },
        languages: [language],
        requestedAttributes: attributes
      });
  
      const scores = response.data.attributeScores;
      const isPolite = Object.values(scores).every(score => score.summaryScore.value < TOXICITY_THRESHOLD);
      return { isPolite, scores };
    } catch (error) {
      console.error('❌ Error en la API de Perspective:', error.response?.data || error.message, 'Texto:', text);
      return { isPolite: null, scores: null };
    }
  }
module.exports = { toxicityService };