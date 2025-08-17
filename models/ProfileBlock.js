// ./app/models/ProfileBlock.js
const mongoose = require('mongoose');

const profileBlockSchema = new mongoose.Schema({
  blocker_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
  },
  blocked_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
  },
  blocked_author: {
    type: String,
    required: true
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
  // Campo opcional para motivos de bloqueo
  reason: {
    type: String,
    enum: ['spam', 'harassment', 'inappropriate', 'other'],
    default: 'other'
  }
});

// Índice compuesto único para evitar duplicados
profileBlockSchema.index({ blocker_id: 1, blocked_id: 1 }, { unique: true });

// Hooks para mantener contadores consistentes
profileBlockSchema.post('save', async function (doc) {
  await mongoose.model('Profile').findByIdAndUpdate(
    doc.blocker_id,
    { $inc: { blockedCount: 1 } }
  );
});

profileBlockSchema.post('deleteOne', { document: true, query: false }, async function (doc) {
  await mongoose.model('Profile').findByIdAndUpdate(
    doc.blocker_id,
    { $inc: { blockedCount: -1 } }
  );
});

// Método estático para verificar bloqueos
profileBlockSchema.statics.isBlocked = async function (blockerId, blockedId) {
  return this.exists({ blocker_id: blockerId, blocked_id: blockedId });
};

module.exports = mongoose.model('ProfileBlock', profileBlockSchema);