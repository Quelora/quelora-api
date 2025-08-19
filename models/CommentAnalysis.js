const mongoose = require('mongoose');

const CommentAnalysisSchema = new mongoose.Schema({
  cid: { type: String, required: true },
  entity: { type: String, required: true },
  analysis: {
    title: String,
    debateSummary: String,
    highlightedComments: [{
      _id: String,
      comment: String,
      reasonHighlighted: String
    }],
    sentiment: {
      positive: String,
      neutral: String,
      negative: String
    }
  },
  lastAnalyzedCommentTimestamp: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

module.exports = mongoose.model('CommentAnalysis', CommentAnalysisSchema);