// ./utils/cacheUtils.js
const { cacheClient } = require('../services/cacheService');

const withCacheInvalidation = (cacheKeyFn) => async (req, res, next) => {
  try {
        // Obtener la clave de caché base
        const cacheKey = cacheKeyFn(req);

        // Crear un patrón para buscar todas las claves que comiencen con cacheKey y tengan un % después
        const pattern = `${cacheKey}*`;

        // Función para eliminar todas las claves que coincidan con el patrón
        const deleteKeysByPattern = async (pattern) => {
        let cursor = '0'; // Cursor inicial
        let keysDeleted = 0; // Contador de claves eliminadas

        do {
            // Usar SCAN para buscar claves que coincidan con el patrón
            const reply = await cacheClient.scan(cursor, {
                MATCH: pattern,
                COUNT: 100, // Número de claves a buscar por iteración (opcional)
            });

            // Actualizar el cursor
            cursor = reply.cursor;

            // Obtener las claves encontradas
            const keys = reply.keys;

            // Verificar si hay claves y si es un array
            if (Array.isArray(keys) && keys.length > 0) {
                await cacheClient.del(keys);
                keysDeleted += keys.length;
                console.log(`❌ Invalid cache (keys: ${keys.join(', ')})`);
            }
        } while (cursor !== '0'); // Continuar hasta que el cursor sea '0'

        console.log(`✅ Total keys deleted: ${keysDeleted}`);
        };

        // Eliminar todas las claves que coincidan con el patrón
        await deleteKeysByPattern(pattern);

        next();  
  } catch (error) {
        console.error('❌Error invalidating cache:', error);
        next(error);s
  }
};

module.exports = { withCacheInvalidation };