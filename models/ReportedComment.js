// ./models/ReportedComment.js
const mongoose = require('mongoose');

const ReportSchema = new mongoose.Schema({
  profile_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Profile', // Referencia al perfil del usuario que reporta
  },
  report_type: {
    type: String,
    required: true,
    enum: ['spam', 'abuse', 'offensive', 'political', 'other'], // Tipos de reporte
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
});

const ReportedCommentSchema = new mongoose.Schema({
  entity_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Post', // Referencia a la publicación (entity)
  },
  comment_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    ref: 'Post.comments', // Referencia al comentario en el modelo Post
  },
  reports: [ReportSchema], // Array de reportes
  created_at: {
    type: Date,
    default: Date.now,
  },
  updated_at: {
    type: Date,
    default: Date.now,
  },
});

// Middleware para actualizar la fecha de modificación
ReportedCommentSchema.pre('save', function (next) {
  this.updated_at = new Date();
  next();
});

// Virtual para calcular el report_count dinámicamente
ReportedCommentSchema.virtual('report_count').get(function () {
  return this.reports.length;
});

// Índice único para evitar duplicados por entity_id y comment_id
ReportedCommentSchema.index({ entity_id: 1, comment_id: 1 }, { unique: true });

module.exports = mongoose.model('ReportedComment', ReportedCommentSchema);