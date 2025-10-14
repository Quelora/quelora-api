const { cacheClient } = require('../services/cacheService');

const recordGeoActivity = async (req, action, entityId = null, timestamp = null) => {
    if (!req.cid || !req.clientCountry) return;

    // 1. Identificador de la Entidad: Formato 'general' o 'entity:[ID]'
    const keyIdentifier = entityId ? `entity:${entityId}` : 'general';

    // 2. Datos Geográficos y IP (la IP debe ser escapada)
    const escapedIp = (req.clientIp || 'unknown').replace(/:/g, ';');

    // 3. Estructura de la Clave de HASH (Value)
    // Formato: [cid]:[keyIdentifier]:[ip]:[country]:[countryCode]:[region]:[regionCode]:[city]:[lat]:[lon]
    const geoKey = [
        req.cid,
        keyIdentifier,
        escapedIp || 'unknown',
        req.clientCountry,
        req.clientCountryCode || 'unknown',
        req.clientRegion || 'unknown',
        req.clientRegionCode || 'unknown',
        req.clientCity || 'unknown',
        req.clientLatitude || '',
        req.clientLongitude || ''
    ].join(':');

    if (timestamp) {
        // Modo Seeding (Registro Histórico)
        const date = new Date(timestamp);
        const pad = (num) => num.toString().padStart(2, '0');
        // Usamos YYYYMMDDHHmm
        const yyyymmddhhmm = date.getUTCFullYear() + pad(date.getUTCMonth() + 1) + pad(date.getUTCDate()) + pad(date.getUTCHours()) + pad(date.getUTCMinutes());
        // Key: geo:activity:timestamp:[action]:[YYYYMMDDHHmm]
        await cacheClient.hIncrBy(
            `geo:activity:timestamp:${action}:${yyyymmddhhmm}`,
            geoKey,
            1
        );
    } else {
        // Modo Real-time (Comportamiento actual)
        // Key: geo:activity:[action]
        await cacheClient.hIncrBy(
            `geo:activity:${action}`,
            geoKey,
            1
        );
    }
};

const recordActivityHit = async (key, action = 'added', entityId = null, timestamp = null) => {
    const cid = key.split(':')[2];
    const type = key.split(':')[1];
    
    // Construir la clave base: activity:[type]:[cid]
    const baseKey = `activity:${type}:${cid}`;
    
    if (timestamp) {
        // Modo Seeding (Registro Histórico)
        const date = new Date(timestamp);
        const pad = (num) => num.toString().padStart(2, '0');
        // Usamos YYYYMMDDHHmm (en UTC)
        const yyyymmddhhmm = date.getUTCFullYear() + pad(date.getUTCMonth() + 1) + pad(date.getUTCDate()) + pad(date.getUTCHours()) + pad(date.getUTCMinutes());
        
        // Key: activity:timestamp:[type]:[cid]:[YYYYMMDDHHmm] (para agregadas)
        // Key: activity:timestamp:[type]:[cid]:[entityId]:[YYYYMMDDHHmm] (para desagregadas)
        const fullKey = entityId 
            ? `activity:timestamp:${type}:${cid}:${entityId}:${yyyymmddhhmm}` 
            : `activity:timestamp:${type}:${cid}:${yyyymmddhhmm}`;
            
        await cacheClient.hIncrBy(fullKey, action, 1);
    } else {
        // Modo Real-time (Comportamiento actual)
        const fullKey = entityId ? `${baseKey}:${entityId}` : baseKey;
        await cacheClient.hIncrBy(fullKey, action, 1);
    }
};

module.exports = { recordGeoActivity, recordActivityHit };