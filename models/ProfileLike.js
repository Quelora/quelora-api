const mongoose = require('mongoose');

const profileLikeSchema = new mongoose.Schema({
  profile_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
  },
  fk_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  fk_type: {
    type: String,
    enum: ['post', 'comment'],
    required: true,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
});

profileLikeSchema.index({ profile_id: 1, fk_id: 1, fk_type: 1 });

// Middleware para actualizar contadores
profileLikeSchema.post('save', async function (doc) {
  await mongoose.model('Profile').findByIdAndUpdate(
    doc.profile_id,
    { $inc: { likesCount: 1 } }
  );
});

profileLikeSchema.post('deleteOne', { document: true, query: false }, async function (doc) {
  await mongoose.model('Profile').findByIdAndUpdate(
    doc.profile_id,
    { $inc: { likesCount: -1 } }
  );
});

module.exports = mongoose.model('ProfileLike', profileLikeSchema);