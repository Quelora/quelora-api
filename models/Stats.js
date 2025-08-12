// ./models/Stats.js

const mongoose = require('mongoose');

const statsSchema = new mongoose.Schema({
  cid: { 
    type: String,
    required: true,
    index: true
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  likesAdded: {
    type: Number,
    default: 0,
  },
  likesRemoved: {
    type: Number,
    default: 0,
  },
  sharesAdded: {
    type: Number,
    default: 0,
  },
  commentsAdded: {
    type: Number,
    default: 0,
  },
  repliesAdded: {
    type: Number,
    default: 0,
  },
});

const Stats = mongoose.model('Stats', statsSchema);

statsSchema.index({ timestamp: 1 });

module.exports = Stats;