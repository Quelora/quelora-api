// ./app/controllers/commentController.js
const mongoose = require('mongoose');
const crypto = require('crypto');

const Post = require('../models/Post');
const Profile = require('../models/Profile');
const ProfileLike = require('../models/ProfileLike');
const ProfileComment = require('../models/ProfileComment');
const ProfileFollower = require('../models/ProfileFollower');
const ProfileFollowRequest = require('../models/ProfileFollowRequest');
const ProfileFollowing = require('../models/ProfileFollowing');
const ProfileBlock = require('../models/ProfileBlock');
const Comment = require('../models/Comment');
const ReportedComment = require('../models/ReportedComment');
const CommentAudio = require('../models/CommentAudio');

const formatComment = require('../utils/formatComment');
const getFirstDefined =  require('../utils/firstDefined');
const { sendNotificationAndLogActivity } = require('../utils/notificationUtils');
const { recordGeoActivity, recordActivityHit } = require('../utils/recordStatsActivity');

const { cacheService } = require('../services/cacheService');
const { toxicityService } = require('../services/toxicityService');
const { moderateService } = require('../services/moderateService');
const { detectLanguage } = require('../services/languageService');
const { translateService } = require('../services/translateService');
const clientConfigService  = require('../services/clientConfigService');
const profileService = require('../services/profileService');

const LIMIT_COMMENTS = parseInt(process.env.LIMIT_COMMENTS, 5) || 5;

const DEFAULT_LANGUAGE = process.env.DEFAULT_LANGUAGE || 'es';

const cleanAndValidateText = (text) => {
  if (!text) {
    return null;
  }

  const cleanedText = text.trim()
                         .replace(/<[^>]*>?/gm, '')
                         .replace(/[^\p{L}\p{N}\p{P}\p{S}\s\u200D\uFE0F]/gu, '');

  return cleanedText;
};

const analyzeCommentToxicity = async (text) => {
  const { isPolite, scores } = await toxicityService(text);
  if (isPolite === null) {
    throw new Error('Error analyzing toxicity');
  }
  return { isPolite, scores };
};

const analyzeCommentPolitic = async (cid, text) => {
  const { isRejected, reason } = await moderateService(cid, text);
  if (isRejected === null) {
    throw new Error('Error analyzing toxicity');
  }
  return { isRejected, reason };
};

const validateAudio = async (text, audio, hash, post, clientConfig) => {
  if (!text || !audio || !hash) {
    throw new Error('Text, audio, and hash are required.');
  }

  const computedHash = crypto.createHash('sha1')
                            .update( audio + text )
                            .digest('hex');
                            
  if (computedHash !== hash) {
    throw new Error('Invalid hash: Audio and text do not match.');
  }

  const max_recording_seconds =  getFirstDefined( post.config?.audio?.max_recording_seconds,
                                                  clientConfig?.audio?.max_recording_seconds,
                                                  Post.getDefaultConfig().audio.max_recording_seconds
                                                );

  const bitrate =  getFirstDefined( post.config?.audio?.bitrate,
                                                clientConfig?.audio?.bitrate,
                                                Post.getDefaultConfig().audio.bitrate
                                              );      
  const tolerance = 0.2; // 20%  tolerance
  const estimatedDuration = estimateWebmOpusDuration(audio, bitrate);
  const maxDurationWithTolerance = max_recording_seconds * (1 + tolerance);

  if (estimatedDuration > maxDurationWithTolerance) {
    throw new Error(
      `Audio duration (${estimatedDuration.toFixed(1)}s) exceeds maximum allowed ` +
      `(${max_recording_seconds}s) + 20% tolerance (${maxDurationWithTolerance.toFixed(1)}s)`
    );
  }

  return true;
};

const estimateWebmOpusDuration = ( base64String, bitrate = 16000 ) => {
  const base64Data = base64String.split(',')[1] || base64String;
  const byteLength = base64Data.length * 0.75;
  const duration = byteLength / (bitrate / 8);
  return duration;
}

const processAudio = async (commentId, audio, hash) => {
  await CommentAudio.create({
    comment_id: commentId,
    audioData: audio,
    audioHash: hash,
    created_at: new Date()
  });
};

const processComment = async ({ 
  req, 
  entity, 
  commentId = null, 
  isReply = false ,
  clientConfig = {}
}) => {
  const author = req.user.author;
  const locale = req.user.locale ?? 'es';
  const cid = req.cid;
  let { text, audio, hash } = req.body;

  text = cleanAndValidateText(text);
  if (!text) {
    throw new Error(isReply ? 'Reply text is required.' : 'Comment text is required.');
  }

  if (!mongoose.Types.ObjectId.isValid(entity) || 
      (commentId && !mongoose.Types.ObjectId.isValid(commentId))) {
    throw new Error('Invalid entity or comment ID.');
  }

  const post = await Post.findOne({ entity, cid, 'deletion.status': 'active' });
  if (!post) {
    throw new Error('Post not found.');
  }

  const interaction =  getFirstDefined( post.config?.interaction,
                                        clientConfig?.interaction,
                                        Post.getDefaultConfig().interaction);

  const visibility =  getFirstDefined( post.config?.visibility,
                                       clientConfig?.visibility,
                                       Post.getDefaultConfig().visibility);      
                                      
  const limits =  getFirstDefined( post.config?.limits,
                                   clientConfig?.limits,
                                   Post.getDefaultConfig().limits);     

  const moderation =  getFirstDefined( post.config?.moderation,
                                       clientConfig?.moderation,
                                       Post.getDefaultConfig().moderation);      

  const language =  getFirstDefined( post.config?.language,
                                     clientConfig?.language,
                                     Post.getDefaultConfig().language);   

  if (visibility !== "public") {
    throw new Error('This post is not public.');
  }

  if ((!isReply && !interaction.allow_comments) || 
      (isReply && !interaction.allow_replies)) {
    throw new Error(isReply ? 'Replies are not allowed for this post.' : 'Comments are not allowed for this post.');
  }

  const maxLength = isReply ? limits.reply_text : limits.comment_text;
  if (text.length > maxLength) {
    throw new Error(`Text must not exceed ${maxLength} characters.`);
  }

  let scores = null;
  if (moderation.enable_toxicity_filter) {
    const toxicity = await analyzeCommentToxicity(text);
    scores = toxicity.scores;
    if (!toxicity.isPolite) {
      throw new Error('Your comment has been blocked due to inappropriate content.');
    }
  }

  if (moderation.enable_content_moderation) {
    const { isRejected, reason } = await analyzeCommentPolitic(cid, text);
    if (isRejected) {
      throw new Error(reason);
    }
  }

  let defaultLanguage = DEFAULT_LANGUAGE;
  if (language.auto_translate) {
    if (!locale.startsWith(DEFAULT_LANGUAGE)) {
      defaultLanguage = await detectLanguage(text);
    }
  }
  defaultLanguage = defaultLanguage.substring(0, 2);

  return {
    text,
    audio,
    hash,
    defaultLanguage,
    scores,
    post,
    author,
    isReply,
    commentId
  };
};

exports.addComment = async (req, res, next) => {
  try {
    const { entity } = req.params;
    const cid = req.cid;
    const clientConfig = await clientConfigService.getClientPostConfig(cid);

    const { text, audio, hash, defaultLanguage, scores, post, author } = await processComment({
      req,
      entity,
      isReply: false,
      clientConfig
    });

    const allow_save_audio = getFirstDefined(
      post.config?.audio?.save_comment_audio,
      clientConfig?.audio?.save_comment_audio,
      Post.getDefaultConfig().audio.save_comment_audio
    );

    if (allow_save_audio && audio) await validateAudio(text, audio, hash, post, clientConfig);

    const profile = await Profile.ensureProfileExists(req.user, req.cid, req.geoData || null);

    const newComment = {
      _id: new mongoose.Types.ObjectId(),
      entity,
      post: post._id,
      profile_id: profile._id,
      author,
      text,
      language: defaultLanguage,
      created_at: new Date(),
      updated_at: new Date(),
      likes: [],
      replies: [],
      visible: true,
      hasAudio: !!(audio && allow_save_audio)
    };

    await Comment.create(newComment);
    await Post.incrementComment(post._id);

    if (allow_save_audio && audio && hash) {
      await processAudio(newComment._id, audio, hash);
    }

    await ProfileComment.create({
      profile_id: profile._id,
      post_id: post._id,
      comment_id: newComment._id,
      created_at: new Date()
    });

    await recordGeoActivity(req, 'comment');
    await recordActivityHit(`activity:comments:${req.cid}`, 'added');

    // Enviar notificación y registrar actividad
    await sendNotificationAndLogActivity({
      req,
      cid,
      entity,
      postId: post._id,
      commentId: newComment._id,
      actionType: 'comment',
      notificationType: 'comment_followers',
      targetPreview: post.description,
      cacheKeys: [`cid:${cid}:thread:${entity}:limit:${LIMIT_COMMENTS}:last:initial`]
    });

    const authorProfile = await Profile.findOne({ author }).select('author name given_name family_name picture locale created_at');
    const formattedComment = formatComment(newComment, authorProfile, author);

    res.status(201).json({ message: 'Comment added successfully.', comment: formattedComment });
    next();
  } catch (error) {
    console.error("❌ Error adding comment:", error);
    res.status(500).json({ message: error.message || 'Internal server error.' });
  }
};

exports.addReply = async (req, res, next) => {
  try {
    const { entity, comment } = req.params;
    const cid = req.cid;
    const clientConfig = await clientConfigService.getClientPostConfig(cid);

    const { text, audio, hash, defaultLanguage, scores, post, author } = await processComment({
      req,
      entity,
      commentId: comment,
      isReply: true,
      clientConfig
    });

    const allow_save_audio = getFirstDefined(
      post.config?.audio?.save_comment_audio,
      clientConfig?.audio?.save_comment_audio,
      false
    );

    if (allow_save_audio && audio) await validateAudio(text, audio, hash, post, clientConfig);

    const profile = await Profile.ensureProfileExists(req.user, req.cid, req.geoData || null);

    const reply = {
      _id: new mongoose.Types.ObjectId(),
      entity,
      post: post._id,
      parent: comment,
      profile_id: profile._id,
      author,
      language: defaultLanguage,
      text,
      likes: [],
      replies: [],
      created_at: new Date(),
      updated_at: new Date(),
      visible: true,
      hasAudio: !!(audio && allow_save_audio)
    };

    await Comment.create(reply);
    await Comment.incrementReplies(comment);
    await Post.incrementComment(post._id);

    if (allow_save_audio && audio && hash) {
      await processAudio(reply._id, audio, hash);
    }

    await ProfileComment.create({
      profile_id: profile._id,
      post_id: post._id,
      comment_id: reply._id,
      created_at: new Date()
    });

    await recordGeoActivity(req, 'reply');
    await recordActivityHit(`activity:replies:${req.cid}`, 'added');

    const commentDoc = await Comment.findById(comment).select('author text cid');
    if (author !== commentDoc.author) {
      await sendNotificationAndLogActivity({
        req,
        cid,
        entity,
        postId: post._id,
        commentId: comment,
        replyId: reply._id,
        actionType: 'reply',
        notificationType: 'comment',
        recipient: commentDoc.author,
        targetPreview: commentDoc.text,
        cacheKeys: [
          `cid:${cid}:thread:${entity}:${comment}:limit:${LIMIT_COMMENTS}:last:none`
        ]
      });
    }

    const authorProfile = await Profile.findOne({ author, cid }).select('author name given_name family_name picture locale created_at');
    const formattedReply = formatComment(reply, authorProfile, author);

    res.status(201).json({ message: 'Reply added successfully.', comment: formattedReply });
    next();
  } catch (error) {
    console.error("❌ Error adding reply:", error);
    res.status(500).json({ message: error.message || 'Internal server error.' });
  }
};

exports.editComment = async (req, res, next) => {
  try {
    const { comment } = req.params;
    const author = req.user.author;
    const cid = req.cid;
    
    const clientConfig = await clientConfigService.getClientPostConfig(cid);

    const commentDoc = await Comment.findOne({
      _id: comment,
      author,
      visible: true
    });

    if (!commentDoc) {
      return res.status(404).json({ message: 'Comment not found or not authorized' });
    }

    if (commentDoc.hasAudio) {
      return res.status(403).json({ message: 'Comments with audio cannot be edited' });
    }

    const post = await Post.findById(commentDoc.post);
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    const { text, defaultLanguage, scores } = await processComment({
      req,
      entity: commentDoc.entity,
      commentId: commentDoc.parent || null,
      isReply: !!commentDoc.parent,
      clientConfig
    });

    const editing =  getFirstDefined( post.config?.editing,
                                    clientConfig?.editing,
                                    Post.getDefaultConfig().editing);   

    if (!editing.allow_edits) {
      return res.status(403).json({ message: 'Editing comments is not allowed for this post.' });
    }

    const editTimeLimit = editing.edit_time_limit * 60 * 1000;
    if (Date.now() - commentDoc.created_at > editTimeLimit) {
      return res.status(403).json({ message: 'The time to edit this comment has expired.' });
    }

    commentDoc.text = text;
    commentDoc.language = defaultLanguage;
    commentDoc.updated_at = new Date();

    await commentDoc.save();

    const authorProfile = await Profile.findOne({ author })
      .select('author name given_name family_name picture locale created_at');

    const formattedComment = formatComment(commentDoc, authorProfile, author);

    res.status(200).json({ 
      message: 'Comment updated successfully',
      comment: formattedComment
    });
    next();
  } catch (error) {
    console.error("❌ Error editing comment:", error);
    res.status(500).json({ message: error.message || 'Internal server error.' });
  }
};

exports.likeComment = async (req, res, next) => {
  try {
    const { entity, comment } = req.params;
    const author = req.user.author;
    const cid = req.cid;

    if (!mongoose.Types.ObjectId.isValid(entity) || !mongoose.Types.ObjectId.isValid(comment)) {
      return res.status(400).json({ error: 'Invalid entity or comment ID' });
    }

    const post = await Post.findOne({ entity, cid, 'deletion.status': 'active' }).select('config.interaction.allow_likes');
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    if (!post.config.interaction.allow_likes) {
      return res.status(403).json({ message: 'Likes are not allowed for this post.' });
    }

    const commentDoc = await Comment.findOne({ _id: comment, post: post._id, visible: true });
    if (!commentDoc) {
      return res.status(404).json({ message: 'Comment not found or not visible' });
    }

    const profile = await Profile.findOne({ author, cid });
    if (!profile) {
      return res.status(404).json({ message: 'Profile not found.' });
    }

    const existingLike = await ProfileLike.findOne({ profile_id: profile._id, fk_id: comment, fk_type: 'comment' });

    let updatedComment;
    if (existingLike) {
      await existingLike.deleteOne();
      updatedComment = await Comment.decrementLikes(comment, author);
      await cacheService.delete(`cid:${cid}:commentLikes:${comment}`);
      await profileService.deleteProfileCache(cid, author);
      await recordActivityHit(`activity:likes:${cid}`, 'removed');
    } else {
      await ProfileLike.create({ profile_id: profile._id, fk_id: comment, fk_type: 'comment', created_at: new Date() });
      updatedComment = await Comment.incrementLikes(comment, author);
      await recordGeoActivity(req, 'like');
      await recordActivityHit(`activity:likes:${cid}`, 'added');

      const getBaseComment = await Comment.getBaseComment(comment);
      const commentId = String(getBaseComment._id) === String(comment) ? comment : getBaseComment._id;
      const replyId = String(getBaseComment._id) === String(comment) ? null : comment;

      if (author !== commentDoc.author) {
        await sendNotificationAndLogActivity({
          req,
          cid,
          entity,
          postId: post._id,
          commentId,
          replyId,
          actionType: 'like',
          notificationType: 'like',
          recipient: commentDoc.author,
          targetPreview: commentDoc.text,
          cacheKeys: [`cid:${cid}:commentLikes:${comment}`]
        });
      }
    }

    const response = {
      liked: !existingLike,
      likesCount: updatedComment.likesCount,
      message: `Like ${existingLike ? 'removed' : 'added'} on the comment :-)`
    };

    res.status(200).json(response);
    next();
  } catch (error) {
    console.error("❌ Error in likeComment:", error);
    next(error);
  }
};

exports.deleteComment = async (req, res, next) => {
  try {
    const { comment } = req.params;
    const author = req.user.author;
    const cid = req.cid;
    
    const clientConfig = await clientConfigService.getClientPostConfig(cid);

    if (!mongoose.Types.ObjectId.isValid(comment)) {
      return res.status(400).json({ message: 'Invalid comment ID' });
    }

    const commentDoc = await Comment.findOne({
      _id: comment,
      author,
      visible: true
    });

    if (!commentDoc) {
      return res.status(404).json({ message: 'Comment not found or not authorized' });
    }

    const postObject = await Post.findById(commentDoc.post);
    if (!postObject) {
      return res.status(404).json({ message: 'Post not found.' });
    }

    const allow_delete =  getFirstDefined( postObject.config?.editing?.allow_delete,
                                           clientConfig?.editing?.allow_delete,
                                           Post.getDefaultConfig().editing.allow_delete
                                          );

    if (!allow_delete) {
      return res.status(403).json({ message: 'Deleting comments is not allowed for this post.' });
    }

    commentDoc.visible = false;
    commentDoc.updated_at = new Date();
    await commentDoc.save();

    if (!commentDoc.parent) {
      await Post.decrementComment(commentDoc.post);
    }

    const profile = await Profile.findOne({ author });
    if (!profile) {
      return res.status(404).json({ message: 'Profile not found.' });
    }

    const existingComment = await ProfileComment.findOne({
      profile_id: profile._id,
      comment_id: comment
    });

    if(existingComment) {
      await existingComment.deleteOne();
    }

    await profileService.deleteProfileCache(cid, author);
    await cacheService.delete(`cid:${cid}:thread:${commentDoc.entity}:limit:${LIMIT_COMMENTS}:last:initial`);
    if (commentDoc.parent) {
      await cacheService.delete(`cid:${cid}:thread:${commentDoc.entity}:${commentDoc.parent}:limit:${LIMIT_COMMENTS}:last:none`);
    }

    const activityType = commentDoc.parent ? 'replies' : 'comments';
    await recordActivityHit(`activity:${activityType}:${cid}`, 'deleted');

    res.status(200).json({ message: 'Comment deleted successfully', commentId: commentDoc._id, entityId: commentDoc.entity });
    next();
  } catch (error) {
    console.error("❌ Error deleting comment:", error);
    next(error);
  }
};

exports.reportComment = async (req, res, next) => {
  try {
    const { comment } = req.params;
    const { type, blocked } = req.body;
    const author = req.user.author;
    const cid = req.cid;

    if (!mongoose.Types.ObjectId.isValid(comment)) {
      return res.status(400).json({ message: 'Invalid comment ID.' });
    }

    const commentDoc = await Comment.findById(comment);

    if (!commentDoc) {
      return res.status(404).json({ message: 'Comment not found.' });
    }

    const [reporterProfile, authorProfile] = await Promise.all([
      await profileService.getProfile(author, cid),
      await profileService.getProfile(commentDoc.author, cid)
    ]);

    if (!reporterProfile || !authorProfile) {
      return res.status(404).json({ message: 'Profile not found.' });
    }

    if (blocked) {
      const alreadyBlocked = await ProfileBlock.exists({
        blocker_id: reporterProfile._id,
        blocked_id: authorProfile._id 
      });

      if (!alreadyBlocked) {
        await new ProfileBlock({
          blocker_id: reporterProfile._id,
          blocked_id: authorProfile._id,
          blocked_author: authorProfile.author,
        }).save();
      }
    }

    let reportedComment = await ReportedComment.findOne({ comment_id: comment });
    if (!reportedComment) {
      reportedComment = new ReportedComment({
        entity_id: commentDoc.post,
        comment_id: comment,
        reports: []
      });
    }

    const existingReport = reportedComment.reports.some(
      report => report.profile_id.toString() === reporterProfile._id.toString()
    );

    if (existingReport) {
      return res.status(400).json({ message: 'You have already reported this comment.' });
    }

    reportedComment.reports.push({ profile_id: reporterProfile._id, report_type: type || 'other', created_at: new Date() });
    await reportedComment.save();
    await profileService.deleteProfileCache(cid, author);

    res.status(200).json({  message: 'Comment reported successfully.', blocked: blocked || false });
    
    next();
  } catch (error) {
    console.error("❌ Error in reportComment:", error);
    next(error);
  }
};

exports.translateComment = async (req, res, next) => {
  try {
    const { comment } = req.params;
    const targetLanguage = req.user?.locale?.substring(0, 2) || 'es';

    if (!mongoose.Types.ObjectId.isValid(comment)) {
      return res.status(400).json({ message: 'Invalid comment ID.' });
    }

    const commentDoc = await Comment.findById(comment);
    if (!commentDoc) {
      return res.status(404).json({ message: 'Comment not found.' });
    }

    const existingTranslation = commentDoc.translates.find(
      t => t.language === targetLanguage
    );

    if (existingTranslation) {
      return res.status(200).json({ translation: existingTranslation.text });
    }

    const translatedText = await translateService(commentDoc.text, targetLanguage);
    const newTranslation = {
      language: targetLanguage,
      text: translatedText,
      created_at: new Date()
    };

    commentDoc.translates.push(newTranslation);
    await commentDoc.save();

    res.status(200).json({ translation: translatedText });
    next();
  } catch (error) {
    console.error("❌ Error translating comment:", error);
    next(error);
  }
};

exports.getLikes = async (req, res, next) => {
  try {
    const { commentId } = req.params;
    const cid = req.cid;
    const author = req?.user?.author || null;
    const limit = 100;

    if (!mongoose.Types.ObjectId.isValid(commentId)) {
      return res.status(400).json({ message: 'Invalid comment ID.' });
    }

    const cacheKey = `cid:${cid}:commentLikes:${commentId}`;
    let response = await cacheService.get(cacheKey);
    if (response && !author) { // Solo usar caché para usuarios no autenticados
      console.log('⚡ Comment likes obtained from cache');
      return res.status(200).json(response);
    }

    const comment = await Comment.findById(commentId).select('likes likesCount');
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found.' });
    }

    const likes = comment.likes.slice(-limit);
    const profiles = await Profile.find({ author: { $in: likes }, cid }).select('author name given_name family_name picture locale created_at _id');

    const profileMap = {};
    profiles.forEach(profile => {
      profileMap[profile.author] = profile;
    });

    let currentProfile = null;
    if (author) {
      currentProfile = await Profile.findOne({ author, cid }).select('_id').lean();
    }

    let formattedLikes = await Promise.all(likes.map(async (authorId) => {
      const profile = profileMap[authorId];
      
      let isFollowing = false;
      let isFollower = false;
      let isFollowRequestSent = false;

      if (currentProfile && profile) {
        [isFollowing, isFollower, isFollowRequestSent] = await Promise.all([
          ProfileFollowing.exists({ profile_id: currentProfile._id, following_id: profile._id }),
          ProfileFollower.exists({ profile_id: profile._id, follower_id: currentProfile._id }),
          ProfileFollowRequest.exists({ profile_id: currentProfile._id, target_id: profile._id, status: 'pending' })
        ]);
      }

      return {
        author: authorId,
        name: profile?.name || 'Unknown',
        given_name: profile?.given_name || 'Unknown',
        family_name: profile?.family_name || 'Unknown',
        picture: profile?.picture || '',
        locale: profile?.locale || 'es',
        created_at: profile?.created_at || new Date(),
        isFollowing: !!isFollowing,
        isFollower: !!isFollower,
        isFollowRequestSent: !!isFollowRequestSent
      };
    }));

    response = { totalLikes: comment.likesCount || 0, displayedLikes: formattedLikes.length, likes: formattedLikes};

    await cacheService.set(cacheKey, response, 3600);

    res.status(200).json(response);
    next();
  } catch (error) {
    console.error("❌ Error getting comment likes:", error);
    next(error);
  }
};

exports.getPostLikes = async (req, res, next) => {
  try {
    const { entity } = req.params;
    const cid = req.cid;
    const author = req.user.author;
    let { commentIds } = req.query;

    if (!mongoose.Types.ObjectId.isValid(entity)) {
      return res.status(400).json({ message: 'Invalid entity ID.' });
    }

    if (!commentIds) {
      return res.status(400).json({ message: 'commentIds query parameter is required.' });
    }

    try {
      commentIds = JSON.parse(commentIds);
      if (!Array.isArray(commentIds) || commentIds.length === 0) {
        return res.status(400).json({ message: 'commentIds must be a non-empty array.' });
      }
      if (!commentIds.every(id => mongoose.Types.ObjectId.isValid(id))) {
        return res.status(400).json({ message: 'All commentIds must be valid ObjectIds.' });
      }
    } catch (error) {
      return res.status(400).json({ message: 'Invalid commentIds format.' });
    }

    const post = await Post.findOne({ 
      entity, 
      cid, 
      'deletion.status': 'active' 
    }).select('config.interaction.allow_likes');

    if (!post) {
      return res.status(404).json({ message: 'Post not found.' });
    }

    if (!post.config.interaction.allow_likes) {
      return res.status(403).json({ message: 'Likes are not allowed for this post.' });
    }

    const comments = await Comment.find({
      _id: { $in: commentIds },
      post: post._id,
      visible: true
    }).select('likes likesCount');

    const commentLikes = comments.map(comment => ({
      commentId: comment._id.toString(),
      likesCount: comment.likesCount || 0,
      authorLiked: comment.likes.includes(author)
    }));

    const foundCommentIds = commentLikes.map(c => c.commentId);
    const missingCommentIds = commentIds.filter(id => !foundCommentIds.includes(id.toString()));
    missingCommentIds.forEach(id => {
      commentLikes.push({
        commentId: id.toString(),
        likesCount: 0,
        authorLiked: false
      });
    });

    const cacheKey = `cid:${cid}:postLikes:${entity}:comments:${commentIds.join(',')}`;
    await cacheService.set(cacheKey, commentLikes, 3600);

    res.status(200).json(commentLikes);
    next();
  } catch (error) {
    console.error("❌ Error getting post likes:", error);
    next(error);
  }
};

exports.getCommentAudio = async (req, res, next) => {
  try {
    const { comment } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(comment)) {
      return res.status(400).json({ message: 'Invalid comment ID.' });
    }

    const commentObject = await Comment.findOne({
      _id: comment,
      visible: true
    }).select('_id hasAudio');

    if (!commentObject) {
      return res.status(404).json({ message: 'Comment not found or not visible.' });
    }

    if (!commentObject.hasAudio) {
      return res.status(404).json({ message: 'This comment does not have an audio.' });
    }

    const commentAudio = await CommentAudio.findOne({ comment_id: comment  }).select('audioData');

    if (!commentAudio) {
      return res.status(404).json({ message: 'Audio not found for this comment.' });
    }

    res.status(200).json({audio: commentAudio.audioData, commentId: comment});
    
  } catch (error) {
    console.error("❌ Error getting comment audio:", error);
    res.status(500).json({ message: error.message || 'Internal server error.' });
  }
};