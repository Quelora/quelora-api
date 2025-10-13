// utils/recordStatsActivity.js
const { cacheClient } = require('../services/cacheService');

const recordGeoActivity = async (req, action, entityId = null) => {
  if (!req.cid || !req.clientCountry) return;
  
  // 1. Identificador de la Entidad: Formato 'general' o 'entity:[ID]'
  const keyIdentifier = entityId ? `entity:${entityId}` : 'general';
  
  // 2. Datos Geográficos y IP (la IP debe ser escapada)
  const escapedIp = (req.clientIp || 'unknown').replace(/:/g, ';');
  
  // 3. Estructura de la Clave de HASH (Value)
  // Formato: [cid]:[keyIdentifier]:[ip]:[country]:[countryCode]:[region]:[regionCode]:[city]:[lat]:[lon]
  // La clave debe tener exactamente 10 segmentos separados por ':'
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
  
  // 4. Guardar en Redis
  await cacheClient.hIncrBy(
    `geo:activity:${action}`,
    geoKey,
    1
  );
};

// Modificación para aceptar un entityId opcional en el hit count
const recordActivityHit = async (key, action = 'added', entityId = null) => {
  // Construir la clave: activity:[type]:[cid]:[entityId]
  const fullKey = entityId ? `${key}:${entityId}` : key;
  await cacheClient.hIncrBy(fullKey, action, 1);
}; 

module.exports = { recordGeoActivity, recordActivityHit };