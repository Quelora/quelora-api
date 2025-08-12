  const mongoose = require('mongoose');

  const commentAudioSchema = new mongoose.Schema({
    comment_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Comment',
      required: true, 
    },
    audioData: {
      type: String,
      required: true
    },
    created_at: {
      type: Date,
      default: Date.now
    }
  });

  module.exports = mongoose.model('CommentAudio', commentAudioSchema);