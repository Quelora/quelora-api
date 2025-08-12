// ./services/cacheService.js
const redis = require('redis');

// Crear el cliente de Redis
const cacheClient = redis.createClient({
  url: process.env.CACHE_URL,
});

// Manejar errores de conexión
cacheClient.on('error', (err) => {
  console.error('❌ Redis error:', err);
});

// Log de conexión exitosa
cacheClient.on('connect', () => {
  console.log('✅ Connected to Redis');
});

// Log de cuando el cliente está listo para recibir comandos
cacheClient.on('ready', () => {
  console.log('✅ Redis client is ready');
});

// Conectar al servidor de Redis
cacheClient.connect();

const cacheService = {
  get: async (key) => {
    try {
      const cachedData = await cacheClient.get(key);
      if (cachedData !== null) {
        return JSON.parse(cachedData);
      }
      return null;
    } catch (error) {
      console.error('Error retrieving data from cache:', error);
      throw error;
    }
  },

  set: async (key, data, ttl = null) => {
    try {
      const serializedData = JSON.stringify(data);

      // Validar que el TTL sea un número entero válido
      if (ttl !== null && (typeof ttl !== 'number' || !Number.isInteger(ttl) || ttl <= 0)) {
        throw new Error('TTL must be a positive integer or null');
      }

      // Guardar en Redis con o sin TTL
      if (ttl) {
        await cacheClient.set(key, serializedData, { EX: ttl });
      } else {
        await cacheClient.set(key, serializedData);
      }
    } catch (error) {
      console.error('Error saving data to cache:', error);
      throw error;
    }
  },

  delete: async (key) => {
    try {
      await cacheClient.del(key);
    } catch (error) {
      console.error('Error deleting data from cache:', error);
      throw error;
    }
  },

  deleteByPattern: async (pattern) => {
    try {
      let cursor = 0;
      do {
        const reply = await cacheClient.scan(cursor, {
          MATCH: pattern,
          COUNT: 100,
        });
        cursor = parseInt(reply.cursor);
        const keys = reply.keys;
        if (keys.length > 0) {
          await cacheClient.del(keys);
        }
      } while (cursor !== 0);
    } catch (error) {
      console.error(`Error deleting keys by pattern "${pattern}":`, error);
      throw error;
    }
  },

  flush: async () => {
    try {
      await cacheClient.flushAll();
    } catch (error) {
      console.error('Error flushing cache:', error);
      throw error;
    }
  },
};

module.exports = { cacheClient, cacheService };