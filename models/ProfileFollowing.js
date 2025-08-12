// ./app/models/ProfileFollowing.js
const mongoose = require('mongoose');

const profileFollowingSchema = new mongoose.Schema({
  profile_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
  },
  following_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
});

profileFollowingSchema.index({ profile_id: 1, following_id: 1 });

profileFollowingSchema.post('save', async function (doc) {
  await mongoose.model('Profile').findByIdAndUpdate(
    doc.profile_id,
    { $inc: { followingCount: 1 } }
  );
});

profileFollowingSchema.post('deleteOne', { document: true, query: false }, async function (doc) {
  await mongoose.model('Profile').findByIdAndUpdate(
    doc.profile_id,
    { $inc: { followingCount: -1 } }
  );
});

profileFollowingSchema.statics.isFollowing = async function (profileId, followingId) {
  if (!profileId || !followingId) return false;
  const existing = await this.exists({
    profile_id: profileId,
    following_id: followingId,
  });
  return !!existing;
};


module.exports = mongoose.model('ProfileFollowing', profileFollowingSchema);