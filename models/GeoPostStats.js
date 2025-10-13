// models/GeoPostStats.js

const mongoose = require('mongoose');

const GeoPostStatsSchema = new mongoose.Schema({
  cid: { type: String, required: true, index: true },
  entity: {
    type: mongoose.Schema.Types.ObjectId, // ID del post/entidad
    required: true,
    index: true
  },
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

GeoPostStatsSchema.index({ 
  cid: 1,
  entity: 1,
  action: 1, 
  country: 1, 
  city: 1, 
  timestamp: 1 
});

// Índice geoespacial para búsquedas por ubicación
GeoPostStatsSchema.index({ location: '2dsphere' });

const GeoPostStats = mongoose.model('GeoPostStats', GeoPostStatsSchema);

module.exports = GeoPostStats;