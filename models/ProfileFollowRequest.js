// ./app/models/ProfileFollowRequest.js
const mongoose = require('mongoose');

const profileFollowRequestSchema = new mongoose.Schema({
  profile_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
  },
  target_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
  responded_at: {
    type: Date,
  },
});

profileFollowRequestSchema.index({ profile_id: 1, target_id: 1 });
profileFollowRequestSchema.index({ profile_id: 1, target_id: 1, status: 1 });
module.exports = mongoose.model('ProfileFollowRequest', profileFollowRequestSchema);