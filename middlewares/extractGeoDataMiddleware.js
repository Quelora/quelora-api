// ./middlewares/extractGeoDataMiddleware.js

const extractGeoData = (req, res, next) => {
  const { 
    'x-ip': ip = '', 
    'x-country': country = '', 
    'x-country-code': countryCode = '',
    'x-region-code': regionCode = '',
    'x-region': region = '',
    'x-city': city = '', 
    'x-lat': lat = '',
    'x-lon': lon = ''
  } = req.headers;

  req.clientIp = ip;
  req.clientCountry = country;
  req.clientCountryCode = countryCode;
  req.clientRegionCode = regionCode;
  req.clientRegion = region;
  req.clientCity = city;
  req.clientLatitude = lat;
  req.clientLongitude = lon;

  req.geoData = { ip, country, countryCode, region, regionCode, city, lat, lon };

  next();
};


module.exports = extractGeoData;