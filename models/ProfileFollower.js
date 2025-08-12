// ./app/models/ProfileFollower.js
const mongoose = require('mongoose');

const profileFollowerSchema = new mongoose.Schema({
  profile_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
  },
  follower_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
});

profileFollowerSchema.index({ profile_id: 1, follower_id: 1 });

profileFollowerSchema.post('save', async function (doc) {
  await mongoose.model('Profile').findByIdAndUpdate(
    doc.profile_id,
    { $inc: { followersCount: 1 } }
  );
});

profileFollowerSchema.post('deleteOne', { document: true, query: false }, async function (doc) {
  await mongoose.model('Profile').findByIdAndUpdate(
    doc.profile_id,
    { $inc: { followersCount: -1 } }
  );
});

module.exports = mongoose.model('ProfileFollower', profileFollowerSchema);