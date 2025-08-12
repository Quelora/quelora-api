const mongoose = require('mongoose');

const profileBookmarkSchema = new mongoose.Schema({
  profile_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
  },
  post_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post',
    required: true,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
});

profileBookmarkSchema.index({ profile_id: 1, post_id: 1 });

// Middleware para actualizar contadores
profileBookmarkSchema.post('save', async function (doc) {
  await mongoose.model('Profile').findByIdAndUpdate(
    doc.profile_id,
    { $inc: { bookmarksCount: 1 } }
  );
});

profileBookmarkSchema.post('deleteOne', { document: true, query: false }, async function (doc) {
  await mongoose.model('Profile').findByIdAndUpdate(
    doc.profile_id,
    { $inc: { bookmarksCount: -1 } }
  );
});

module.exports = mongoose.model('ProfileBookmark', profileBookmarkSchema);