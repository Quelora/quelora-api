// models/Comment.js
const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  post: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post',
    required: true
  }, 
  entity: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Commnet',
    default: null
  },
  profile_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
  },
  author: {
    type: String,
    required: true,
    unique: false
  },
  text: {
    type: String,
    required: true
  },  
  reference: {
    type: String,
    required: false,
    unique: false,
    index: true
  },
  language: {
    type: String,
    required: false,
    default: 'es'
  },
  likes: [{
    type: String,
  }],
  repliesCount: {
    type: Number,
    default: 0 
  },
  likesCount: {
    type: Number,
    default: 0 
  },  
  visible: {
    type: Boolean,
    default: true
  },
  translates: [{
    language: {
      type: String,
      required: true
    },
    text: {
      type: String,
      required: true
    },
    created_at: {
      type: Date,
      default: Date.now
    }
  }],
  hasAudio: {
    type: Boolean,
    default: false
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  },
});

commentSchema.statics = {

  async isDescendantOf (replyId, commentId){
    if (!mongoose.Types.ObjectId.isValid(replyId) || !mongoose.Types.ObjectId.isValid(commentId)) {
      return false;
    }
  
    let currentComment = await this.findOne({ _id: replyId, visible: true });
    if (!currentComment) {
      return false;
    }
  
    while (currentComment.parent) {
      if (currentComment.parent.equals(commentId)) {
        return true;
      }
      currentComment = await this.findOne({ _id: currentComment.parent, visible: true });
      if (!currentComment) {
        return false;
      }
    }
  
    return false;
  },
  /**
   * Obtiene el comentario base (sin parent) a partir de un replyId
   * @param {String} replyId - ID del comentario de respuesta
   * @returns {Promise} Promesa con el comentario base o null si no se encuentra
   */
  async getBaseComment(replyId) {
    if (!mongoose.Types.ObjectId.isValid(replyId)) {
      return null;
    }
  
    let currentComment = await this.findOne({ _id: replyId, visible: true });
    if (!currentComment) {
      return null;
    }
  
    while (currentComment.parent) {
      currentComment = await this.findOne({ _id: currentComment.parent, visible: true });
      if (!currentComment) {
        return null;
      }
    }
  
    return currentComment;
  },
  /**
   * Incrementa el contador de likes en 1
   * @param {String} commentId - ID del comentario
   * @param {String} userId - ID del usuario que dio like
   * @returns {Promise} Promesa con el comentario actualizado
   */
  async incrementLikes(commentId, userId) {
    return this.findByIdAndUpdate(
      commentId,
      {
        $inc: { likesCount: 1 },
        $addToSet: { likes: userId }
      },
      { new: true }
    );
  },
  /**
   * Decrementa el contador de likes en 1
   * @param {String} commentId - ID del comentario
   * @param {String} userId - ID del usuario que quitó el like
   * @returns {Promise} Promesa con el comentario actualizado
   */
  async decrementLikes(commentId, userId) {
    return this.findByIdAndUpdate(
      commentId,
      {
        $inc: { likesCount: -1 },
        $pull: { likes: userId }
      },
      { new: true }
    );
  },

  /**
   * Incrementa el contador de respuestas en 1
   * @param {String} commentId - ID del comentario padre
   * @returns {Promise} Promesa con el comentario actualizado
   */
  async incrementReplies(commentId) {
    return this.findByIdAndUpdate(
      commentId,
      { $inc: { repliesCount: 1 } },
      { new: true }
    );
  },

  /**
   * Decrementa el contador de respuestas en 1
   * @param {String} commentId - ID del comentario padre
   * @returns {Promise} Promesa con el comentario actualizado
   */
  async decrementReplies(commentId) {
    return this.findByIdAndUpdate(
      commentId,
      { $inc: { repliesCount: -1 } },
      { new: true }
    );
  }
};

commentSchema.pre('save', function(next) {
  if (this.likes.length > 1000) {
    this.likes = this.likes.slice(-1000);
  }
  next();
});


// Índices para optimizar búsquedas
commentSchema.index({ post: 1 });
commentSchema.index({ comment: 1 });
commentSchema.index({ profile_id: 1 });
commentSchema.index({ author: 1 });
commentSchema.index({ created_at: -1 });
/* commentSchema.index({ text: "text" }); generates problems with emojis */

module.exports = mongoose.model('Comment', commentSchema);
