const { cacheClient } = require('../services/cacheService');

const recordGeoActivity = async (req, action) => {
  if (!req.cid || !req.clientCountry) return;
  
  const escapedIp = (req.clientIp || 'unknown').replace(/:/g, ';');

  const geoKey = `geo:${req.cid}:${escapedIp || 'unknown'}:${req.clientCountry}:${req.clientCountryCode || 'unknown'}:${req.clientRegion || 'unknown'}:${req.clientRegionCode || 'unknown'}:${req.clientCity || 'unknown'}:${req.clientLatitude || ''}:${req.clientLongitude || ''}`;
  

  await cacheClient.hIncrBy(
    `geo:activity:${action}`,
    geoKey,
    1
  );
};

const recordActivityHit = async (key, action = 'added') => {
    await cacheClient.hIncrBy(key, action, 1);
}; 

module.exports = { recordGeoActivity, recordActivityHit };