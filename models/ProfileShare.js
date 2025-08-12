const mongoose = require('mongoose');

const profileShareSchema = new mongoose.Schema({
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

profileShareSchema.index({ profile_id: 1, post_id: 1 });

// Middleware para actualizar contadores
profileShareSchema.post('save', async function (doc) {
  await mongoose.model('Profile').findByIdAndUpdate(
    doc.profile_id,
    { $inc: { sharesCount: 1 } }
  );
});

profileShareSchema.post('deleteOne', { document: true, query: false }, async function (doc) {
  await mongoose.model('Profile').findByIdAndUpdate(
    doc.profile_id,
    { $inc: { sharesCount: -1 } }
  );
});

module.exports = mongoose.model('ProfileShare', profileShareSchema);