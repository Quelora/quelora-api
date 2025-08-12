const mongoose = require('mongoose');

const profileCommentSchema = new mongoose.Schema({
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
  comment_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Comment',
    required: true,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
});

profileCommentSchema.index({ profile_id: 1, post_id: 1, comment_id: 1 });

// Middleware para actualizar contadores
profileCommentSchema.post('save', async function (doc) {
  await mongoose.model('Profile').findByIdAndUpdate(
    doc.profile_id,
    { $inc: { commentsCount: 1 } }
  );
});

profileCommentSchema.post('deleteOne', { document: true, query: false }, async function (doc) {
  await mongoose.model('Profile').findByIdAndUpdate(
    doc.profile_id,
    { $inc: { commentsCount: -1 } }
  );
});

module.exports = mongoose.model('ProfileComment', profileCommentSchema);