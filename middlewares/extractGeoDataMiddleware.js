// ./middlewares/extractGeoDataMiddleware.js
const maxmind = require('maxmind');
const path = require('path');

let cityLookup; // Cache for MaxMind DB reader instance

/**
 * Loads the MaxMind GeoLite2 City database if not loaded yet.
 * Uses a singleton pattern to avoid reopening the DB on every request.
 */
async function loadMaxMindDB() {
  if (!cityLookup) {
    const dbPath = path.resolve(__dirname, '../db/GeoLite2-City.mmdb');
    cityLookup = await maxmind.open(dbPath);
  }
}

/**
 * Middleware to extract geographic data from request.
 * 
 * Priority:
 * 1. Use geo headers if present.
 * 2. If geolocation provider is 'maxmind' and enabled, use local MaxMind DB lookup.
 * 3. Populate req object with geo data fields for downstream use.
 * 
 * It handles any errors internally and calls next() regardless,
 * so it never blocks the request flow.
 * 
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @param {import('express').NextFunction} next - Express next middleware function
 */
const extractGeoData = async (req, res, next) => {
  try {
    const { 
      'x-ip': ipHeader = '', 
      'x-country': countryHeader = '', 
      'x-country-code': countryCodeHeader = '',
      'x-region-code': regionCodeHeader = '',
      'x-region': regionHeader = '',
      'x-city': cityHeader = '', 
      'x-lat': latHeader = '',
      'x-lon': lonHeader = ''
    } = req.headers;

    // Initialize geo variables with header values (fallback empty string)
    let ip = ipHeader;
    let country = countryHeader;
    let countryCode = countryCodeHeader;
    let region = regionHeader;
    let regionCode = regionCodeHeader;
    let city = cityHeader;
    let lat = latHeader;
    let lon = lonHeader;

    // Default provider to 'header' if data comes from headers
    let provider = 'header';

    const geolocationConfig = req.clientConfig?.geolocation || {};

    if (geolocationConfig.enabled && geolocationConfig.provider === 'maxmind') {
      if (!ip) {
        ip = req.ip || req.connection?.remoteAddress || '';
      }

      if (ip) {
        await loadMaxMindDB();

        const geo = cityLookup.get(ip);

        if (geo) {
          country = geo.country?.names?.en || country;
          countryCode = geo.country?.iso_code || countryCode;
          region = geo.subdivisions?.[0]?.names?.en || region;
          regionCode = geo.subdivisions?.[0]?.iso_code || regionCode;
          city = geo.city?.names?.en || city;
          lat = geo.location?.latitude || lat;
          lon = geo.location?.longitude || lon;
          provider = 'maxmind';
        }
      }
    }

    req.clientIp = ip;
    req.clientCountry = country;
    req.clientCountryCode = countryCode;
    req.clientRegion = region;
    req.clientRegionCode = regionCode;
    req.clientCity = city;
    req.clientLatitude = lat;
    req.clientLongitude = lon;

    req.geoData = { ip, country, countryCode, region, regionCode, city, lat, lon, provider };
    next();
  } catch (err) {
    console.error('Error in extractGeoDataMiddleware:', err);
    next();
  }
};

module.exports = extractGeoData;
