const mongoose = require('mongoose');
const { cacheService } = require('../services/cacheService');
const { translateService } = require('../services/translateService');
const Comment = require('../models/Comment');
const CommentAnalysis = require('../models/CommentAnalysis');
const formatComment = require('../utils/formatComment');
const { getProfilesForComments, getSessionUserId } = require('./profileUtils');

const ANALYSIS_TTL_SEC = 300;

/**
 * Retrieves cached analysis data
 * @param {Object} cacheKeys - Base and translated cache keys
 * @param {string} targetLanguage - Target language for translation
 * @returns {Promise<Object|null>} Cached analysis or null
 */
async function getCachedAnalysis(cacheKeys, targetLanguage) {
  let cachedAnalysis = await cacheService.get(cacheKeys.translated);
  let isTranslatedCache = true;

  if (!cachedAnalysis) {
    cachedAnalysis = await cacheService.get(cacheKeys.base);
    isTranslatedCache = false;
  }

  if (cachedAnalysis && !isTranslatedCache && targetLanguage !== 'en' && cachedAnalysis.debateSummary) {
    try {
      cachedAnalysis = JSON.parse(JSON.stringify(cachedAnalysis));
      cachedAnalysis.originalDebateSummary = cachedAnalysis.debateSummary;
      cachedAnalysis.debateSummary = await translateService(cachedAnalysis.debateSummary, targetLanguage);
      await cacheService.set(cacheKeys.translated, cachedAnalysis, ANALYSIS_TTL_SEC);
    } catch (error) {
      console.error('Translation error:', error);
    }
  }

  return cachedAnalysis;
}

/**
 * Updates author likes in cached analysis
 * @param {Object} analysis - Cached analysis data
 * @param {string|null} author - User author ID
 * @returns {Promise<Object>} Updated analysis
 */
async function updateAuthorLikes(analysis, author) {
  if (!author || !Array.isArray(analysis.highlightedComments)) {
    return analysis;
  }

  const commentIds = analysis.highlightedComments
    .map(hc => hc?.comment?._id)
    .filter(Boolean);

  if (!commentIds.length) {
    return analysis;
  }

  const comments = await Comment.find({ _id: { $in: commentIds } })
    .select('_id likes likesCount')
    .lean();

  const commentMap = new Map(comments.map(c => [String(c._id), c]));
  return {
    ...analysis,
    highlightedComments: analysis.highlightedComments.map(hc => {
      if (!hc.comment?._id) return hc;
      
      const commentData = commentMap.get(String(hc.comment._id));
      return {
        ...hc,
        comment: {
          ...hc.comment,
          authorLiked: commentData 
            ? commentData.likes?.some(x => 
                typeof x?.equals === 'function' 
                  ? x.equals(author) 
                  : String(x) === String(author)
              ) ?? false
            : false,
          likesCount: commentData?.likesCount ?? hc.comment.likesCount ?? 0
        }
      };
    })
  };
}

/**
 * Builds comment query based on post and previous analysis
 * @param {string} postId - Post ID
 * @param {Object|null} previousAnalysisDoc - Previous analysis document
 * @returns {Object} Comment query
 */
function buildCommentQuery(postId, previousAnalysisDoc) {
  const query = { post: postId, parent: null, visible: true };
  if (previousAnalysisDoc?.lastAnalyzedCommentTimestamp) {
    query.created_at = { $gt: previousAnalysisDoc.lastAnalyzedCommentTimestamp };
  }
  return query;
}

/**
 * Processes highlighted comments
 * @param {Object} analysis - Analysis result
 * @param {Array} newComments - New comments
 * @param {string|null} author - User author ID
 * @param {string} cid - Client/community ID
 * @returns {Promise<Object>} Formatted analysis
 */
async function processHighlightedComments(analysis, newComments, author, cid) {
  const highlightedComments = Array.isArray(analysis?.highlightedComments) 
    ? analysis.highlightedComments 
    : [];

  if (!highlightedComments.length) {
    return { ...analysis, highlightedComments: [] };
  }

  const commentIds = highlightedComments
    .map(hc => hc?._id)
    .filter(id => mongoose.Types.ObjectId.isValid(id));
  
  // Fetch all relevant comments in one query
  const allComments = await Comment.find({ 
    _id: { $in: commentIds }, 
    visible: true 
  }).select('_id text repliesCount likesCount created_at author').lean();

  const commentMap = new Map(allComments.map(c => [String(c._id), c]));
  const profileMap = await getProfilesForComments(
    allComments,
    await getSessionUserId(author, cid),
    cid
  );

  const formattedComments = await Promise.all(
    highlightedComments.map(async hc => {
      if (!mongoose.Types.ObjectId.isValid(hc._id)) {
        console.debug(`Invalid comment ID: ${hc._id}`);
        return hc;
      }

      const fullComment = commentMap.get(String(hc._id));
      if (!fullComment) {
        console.debug(`Comment not found: ${hc._id}`);
        return hc;
      }

      const formattedComment = await formatComment(
        { ...fullComment, replies_visibles: fullComment.repliesCount || 0 },
        profileMap[fullComment.author],
        author
      );

      formattedComment.authorLiked = author
        ? (fullComment.likes || []).some(x =>
            typeof x?.equals === 'function' 
              ? x.equals(author) 
              : String(x) === String(author)
          )
        : false;
      formattedComment.likesCount = fullComment.likesCount ?? 0;

      return { ...hc, comment: formattedComment };
    })
  );

  return { ...analysis, highlightedComments: formattedComments };
}

/**
 * Handles translation of debate summary
 * @param {Object} analysis - Analysis data
 * @param {string} targetLanguage - Target language
 * @param {Object} cacheKeys - Cache keys
 * @returns {Promise<Object>} Translated analysis
 */
async function handleTranslation(analysis, targetLanguage, cacheKeys) {
  const result = JSON.parse(JSON.stringify(analysis));
  if (targetLanguage !== 'en' && result.debateSummary) {
    try {
      result.originalDebateSummary = result.debateSummary;
      result.debateSummary = await translateService(result.debateSummary, targetLanguage);
    } catch (error) {
      console.error('Translation error:', error);
    }
  }
  return result;
}

/**
 * Updates comment analysis in database
 * @param {string} cid - Client/community ID
 * @param {string} entity - Entity ID
 * @param {Object} analysis - Analysis data
 * @returns {Promise<void>}
 */
async function updateCommentAnalysis(cid, entity, analysis) {
  await CommentAnalysis.findOneAndUpdate(
    { cid, entity },
    {
      cid,
      entity,
      analysis,
      lastAnalyzedCommentTimestamp: new Date()
    },
    { upsert: true }
  );
}

/**
 * Caches analysis data
 * @param {Object} cacheKeys - Cache keys
 * @param {Object} analysis - Analysis data
 * @param {string} targetLanguage - Target language
 * @returns {Promise<void>}
 */
async function cacheAnalysis(cacheKeys, analysis, targetLanguage) {
  await cacheService.set(cacheKeys.base, analysis, ANALYSIS_TTL_SEC);
  if (targetLanguage !== 'en') {
    await cacheService.set(cacheKeys.translated, analysis, ANALYSIS_TTL_SEC);
  }
}

module.exports = {
  getCachedAnalysis,
  updateAuthorLikes,
  buildCommentQuery,
  processHighlightedComments,
  handleTranslation,
  updateCommentAnalysis,
  cacheAnalysis
};