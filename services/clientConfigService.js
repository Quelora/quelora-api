// app/services/clientConfigService.js
const { cacheService } = require('./cacheService');
const User = require('../models/User');

const CACHE_PREFIX = 'client_config';
const CACHE_TTL = 3600; // Cache time-to-live in seconds (1 hour)

/**
 * Retrieves the decrypted configuration for a client (by `cid`).
 * Optionally allows fetching a nested property via `path`.
 * 
 * @param {string} cid - The client ID.
 * @param {string} [path=''] - Optional dot-separated path to retrieve a nested config value.
 * @returns {Promise<any|null>} - The full config or a nested value, or null if not found.
 */
async function getClientConfig(cid, path = '') {
  const cacheKey = `${CACHE_PREFIX}:${cid}`;
  
  try {
    // Attempt to get config from cache
    let clientConfig = await cacheService.get(cacheKey);

    // If not cached, fetch from database
    if (!clientConfig) {
      const user = await User.findOne(
        { 'clients.cid': cid },
        { 'clients.$': 1 } // Return only the matched client
      );
      
      if (!user || !user.clients || user.clients.length === 0) {
        return null;
      }

      // Decrypt the client configuration
      clientConfig = user.decryptConf(user.clients[0].config);
      
      // Store the config in cache
      await cacheService.set(cacheKey, clientConfig, CACHE_TTL);
    }

    if (!clientConfig) {
      return null;
    }

    // Return full config or specific value by path
    if (!path) {
      return clientConfig;
    }

    return getValueByPath(clientConfig, path);
  } catch (error) {
    console.error(`Error getting client config for CID ${cid}:`, error);
    return null;
  }
}

/**
 * Retrieves the post-specific configuration for a client (by `cid`).
 * Optionally allows fetching a nested property via `path`.
 * 
 * @param {string} cid - The client ID.
 * @param {string} [path=''] - Optional dot-separated path to retrieve a nested config value.
 * @returns {Promise<any|null>} - The full post config or a nested value, or null if not found.
 */
async function getClientPostConfig(cid, path = '') {
  const cacheKey = `${CACHE_PREFIX}:${cid}:post`;
  
  try {
    // Attempt to get post config from cache
    let clientPostConfig = await cacheService.get(cacheKey);

    // If not cached, fetch from database
    if (!clientPostConfig) {
      const user = await User.findOne(
        { 'clients.cid': cid },
        { 'clients.$': 1 }
      );
      
      if (!user || !user.clients || user.clients.length === 0) {
        return null;
      }

      // Extract the post-specific config directly
      clientPostConfig = user.clients[0].postConfig;

      // Store in cache
      await cacheService.set(cacheKey, clientPostConfig, CACHE_TTL);
    }

    if (!clientPostConfig) {
      return null;
    }

    // Return full config or specific value by path
    if (!path) {
      return clientPostConfig;
    }

    return getValueByPath(clientPostConfig, path);
  } catch (error) {
    console.error(`Error getting client config for CID ${cid}:`, error);
    return null;
  }
}

/**
 * Retrieves the VAPID configuration for a client (by `cid`).
 * This is typically used for web push notification setup.
 * 
 * @param {string} cid - The client ID.
 * @returns {Promise<any|null>} - The decrypted VAPID object, or null if not found.
 */
async function getClientVapidConfig(cid) {
  const cacheKey = `${CACHE_PREFIX}:${cid}:vapid`;

  try {
    // Attempt to retrieve from cache
    let vapidConfig = await cacheService.get(cacheKey);

    // If not cached, fetch from DB and decrypt
    if (!vapidConfig) {
      const user = await User.findOne(
        { 'clients.cid': cid },
        { 'clients.$': 1 }
      );

      if (!user || !user.clients || user.clients.length === 0) {
        return null;
      }

      const client = user.clients[0];
      vapidConfig = user.decryptVapid(client.vapid);

      // Store in cache
      await cacheService.set(cacheKey, vapidConfig, CACHE_TTL);
    }

    return vapidConfig || null;
  } catch (error) {
    console.error(`Error getting VAPID config for CID ${cid}:`, error);
    return null;
  }
}

/**
 * Retrieves the Email configuration for a client (by `cid`).
 * 
 * @param {string} cid - The client ID.
 * @returns {Promise<any|null>} - The decrypted Email object, or null if not found.
 */
async function getClientEmailConfig(cid) {
  const cacheKey = `${CACHE_PREFIX}:${cid}:email`;

  try {
    // Attempt to retrieve from cache
    let emailConfig = await cacheService.get(cacheKey);

    // If not cached, fetch from DB and decrypt
    if (!emailConfig) {
      const user = await User.findOne(
        { 'clients.cid': cid },
        { 'clients.$': 1 }
      );

      if (!user || !user.clients || user.clients.length === 0) {
        return null;
      }

      const client = user.clients[0];
      emailConfig = user.decryptEmail(client.email);

      // Store in cache
      await cacheService.set(cacheKey, emailConfig, CACHE_TTL);
    }

    return emailConfig || null;
  } catch (error) {
    console.error(`Error getting EMAIL config for CID ${cid}:`, error);
    return null;
  }
}

/**
 * Safely retrieves a nested value from an object using a dot-separated path string.
 * 
 * @param {object} obj - The source object.
 * @param {string} path - The dot-separated path (e.g., "settings.theme.color").
 * @returns {any|null} - The value found at the path, or null if not found.
 */
function getValueByPath(obj, path) {
  if (!obj) return null;
  
  const parts = path.split('.');
  let current = obj;

  for (const part of parts) {
    if (current[part] === undefined) {
      return null;
    }
    current = current[part];
  }

  return current;
}

/**
 * Clears the cached client configuration for a given `cid`.
 * Useful when the client's config is updated and must be refreshed.
 * 
 * @param {string} cid - The client ID.
 */
async function clearClientConfigCache(cid) {
  const cacheKey = `${CACHE_PREFIX}:${cid}`;
  await cacheService.delete(cacheKey);
}

// Export functions for external use
module.exports = {
  getClientConfig,
  getClientPostConfig,
  getClientVapidConfig,
  getClientEmailConfig,
  clearClientConfigCache
};
