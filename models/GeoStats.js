// models/GeoStats.js
const mongoose = require('mongoose');

const GeoStatsSchema = new mongoose.Schema({
  cid: { type: String, required: true, index: true },
  action: { type: String, enum: ['like', 'share', 'comment', 'reply', 'hit'], required: true },
  ip: { type: String },
  country: { type: String, required: true },
  countryCode: { type: String },
  region: { type: String },
  regionCode: { type: String },
  city: { type: String },
  latitude: { type: Number },
  longitude: { type: Number },
  count: { type: Number, default: 0 },
  timestamp: { type: Date, default: Date.now }
});

GeoStatsSchema.index({ 
  action: 1, 
  ip: 1,
  country: 1, 
  countryCode: 1,
  region: 1, 
  regionCode: 1,
  city: 1, 
  timestamp: 1 
});

// Índice geoespacial para búsquedas por ubicación
GeoStatsSchema.index({ location: '2dsphere' });

const GeoStats = mongoose.model('GeoStats', GeoStatsSchema);

module.exports = GeoStats;