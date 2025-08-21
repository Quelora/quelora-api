const mongoose = require('mongoose');
const Post = require('../models/Post');
const Profile = require('../models/Profile');
const ProfileLike = require('../models/ProfileLike');
const ProfileShare = require('../models/ProfileShare');
const ProfileBookmark = require('../models/ProfileBookmark');
const ProfileFollowing = require('../models/ProfileFollowing');
const ProfileFollower = require('../models/ProfileFollower');
const ProfileFollowRequest = require('../models/ProfileFollowRequest');
const CommentAnalysis = require('../models/CommentAnalysis');

const Comment = require('../models/Comment');
const { cacheService } = require('../services/cacheService');
const { recordGeoActivity, recordActivityHit } = require('../utils/recordStatsActivity');
const { enrichLikesWithFollowStatus } = require('../utils/followStatusUtils');
const activityService = require('../services/activityService');
const profileService = require('../services/profileService');
const { commentAnalysisService } = require('../services/commentAnalysisService');

const formatComment = require('../utils/formatComment');
const { getSessionUserId, getUserLanguage, getProfilesForComments } = require('../utils/profileUtils');
const { getCachedAnalysis, updateAuthorLikes, buildCommentQuery, processHighlightedComments, handleTranslation, updateCommentAnalysis, cacheAnalysis } = require('../utils/commentAnalysisUtils');

const LIMIT_COMMENTS = parseInt(process.env.LIMIT_COMMENTS, 15) || 15;

const incrementPostViews = async (cid, entities) => {
  for (const entity of entities) {
    const viewCacheKey = `cid:${cid}:postViews:${entity}`;
    const currentViews = await cacheService.get(viewCacheKey);
    if (currentViews !== null) {
      await cacheService.set(viewCacheKey, parseInt(currentViews) + 1, 3600);
    } else {
      await cacheService.set(viewCacheKey, 1, 3600);
    }
  }
};

exports.getNestedComments = async (req, res, next) => {
  try {
    const { entity } = req.params;
    const author = req?.user?.author ?? null;
    const { commentId, replyId } = req.query;
    const cid = req.cid;
    if (!mongoose.Types.ObjectId.isValid(commentId) || 
        (replyId && !mongoose.Types.ObjectId.isValid(replyId))) {
      throw new Error('Invalid comment or reply ID');
    }

    const cacheKey = `cid:${cid}:nestedComments:${commentId}:${replyId}:${author || 'anonymous'}`; 
    const cachedData = await cacheService.get(cacheKey);
    
    if (cachedData) {
      console.log('⚡ Nested comments obtained from cache');
      return res.status(200).json(cachedData);
    }

    const getRepliesRecursively = async (parentId, depth = 0, maxDepth = 10) => {
      if (depth > maxDepth) {
        console.warn('Maximum recursion depth reached');
        return { list: [], totalReplies: 0, hasMore: false, lastCommentId: null };
      }

      const query = {
        parent: parentId,
        visible: true
      };

      const replies = await Comment.find(query)
        .sort({ _id: -1 })
        .lean();

      if (replies.length === 0) {
        return { list: [], totalReplies: 0, hasMore: false, lastCommentId: null };
      }

      const profileMap = await getProfilesForComments(replies, await getSessionUserId(author, cid), cid);

      const processedReplies = await Promise.all(
        replies.map(async reply => {
          const formattedReply = await formatComment({
            ...reply,
            replies_visibles: reply.repliesCount || 0
          }, profileMap[reply.author], author);

          const nestedReplies = await getRepliesRecursively(reply._id, depth + 1, maxDepth);

          return {
            ...formattedReply,
            replies: nestedReplies
          };
        })
      );

      return {
        list: processedReplies,
        totalReplies: processedReplies.length,
        hasMore: false,
        lastCommentId: processedReplies.length > 0 ? processedReplies[processedReplies.length - 1]._id : null
      };
    };

    // Validate that commentId exists and is visible
    const rootComment = await Comment.findOne({
      _id: commentId,
      visible: true
    }).lean();

    if (!rootComment) {
      throw new Error('Comment not found or not visible');
    }

    // If there is replyId, validate that it is a descendant of commentId
    if (replyId) {
      const isValidReply = await Comment.isDescendantOf(replyId, commentId);
      if (!isValidReply) {
        throw new Error('Reply ID is not a descendant of commentId');
      }
    }

    const repliesTree = await getRepliesRecursively(commentId, 0, 10);

    const result = {
      entityId: entity,
      commentId,
      totalReplies: repliesTree.totalReplies,
      hasMore: true,
      lastCommentId: repliesTree.lastCommentId,
      list: repliesTree.list
    };

    await cacheService.set(cacheKey, result, 3600);

    res.status(200).json(result);
  } catch (error) {
    console.error('Error in getNestedComments:', error);
    next(error);
  }
};

exports.getEntityThread = async (req, res, next) => {
  try {
    const { entity } = req.params;
    const author = req?.user?.author ?? null;
    const { lastCommentId, includeLast } = req.query;
    const cid = req.cid;

    const parsedLimit = LIMIT_COMMENTS;
    const baseCacheKey = `cid:${cid}:thread:${entity}:limit:${parsedLimit}:last:${lastCommentId || 'initial'}:includeLast:${includeLast || 'false'}:anonymous`;
    const userCacheKey = author ? `cid:${cid}:thread:${entity}:limit:${parsedLimit}:last:${lastCommentId || 'initial'}:includeLast:${includeLast || 'false'}:user:${author}` : null;

    if (!mongoose.Types.ObjectId.isValid(entity)) {
      return res.status(400).json({ message: 'Invalid entity ID.' });
    }

    if (author && userCacheKey) {
      const cachedUserData = await cacheService.get(userCacheKey);
      if (cachedUserData) {
        console.log('⚡ User-specific data obtained from cache');
        return res.status(200).json(cachedUserData);
      }
    }

    const cachedAnonData = await cacheService.get(baseCacheKey);
    if (cachedAnonData && !author) {
      console.log('⚡ Anonymous data obtained from cache');
      return res.status(200).json(cachedAnonData);
    }

    const post = await Post.findOne({ entity, cid, 'deletion.status': 'active' })
      .select('likesCount sharesCount commentCount');

    if (!post) {
      return res.status(404).json({ message: 'Post not found.' });
    }

    const commentQuery = { post: post._id, parent: null, visible: true };

    if (lastCommentId && mongoose.Types.ObjectId.isValid(lastCommentId)) {
      if (includeLast === 'true') {
        commentQuery._id = { $lte: lastCommentId };
      } else {
        commentQuery._id = { $lt: lastCommentId };
      }
    }

    const comments = await Comment.find(commentQuery)
                                  .sort({ _id: -1 })
                                  .limit(parsedLimit + (includeLast === 'true' ? 0 : 1))
                                  .lean();

    let hasMore = false;
    let paginatedComments = comments;
    
    if (includeLast !== 'true') {
      hasMore = comments.length > parsedLimit;
      paginatedComments = hasMore ? comments.slice(0, parsedLimit) : comments;
    }

    let profileMap = {};
    let formattedComments = [];

    if (paginatedComments.length > 0) {
      profileMap = await getProfilesForComments(paginatedComments, await getSessionUserId(author, cid), cid);
      formattedComments = await Promise.all(
        paginatedComments.map(comment =>
          formatComment({
            ...comment,
            replies_visibles: comment.repliesCount || 0
          }, profileMap[comment.author], author)
        )
      );
    }

    const response = {
      entity,
      likes: post.likesCount || 0,
      shares: post.sharesCount || 0,
      comments: {
        total: post.commentCount || 0,
        hasMore,
        list: formattedComments,
        lastCommentId: paginatedComments.length > 0
          ? paginatedComments[paginatedComments.length - 1]._id
          : null,
      },
    };

    await cacheService.set(baseCacheKey, {
      ...response,
      comments: {
        ...response.comments,
        list: response.comments.list.map(comment => ({
          ...comment,
          authorLiked: false
        }))
      }
    }, 3600);

    if (author && userCacheKey) {
      await cacheService.set(userCacheKey, response, 3600);
    }

    res.status(200).json(author ? response : {
      ...response,
      comments: {
        ...response.comments,
        list: response.comments.list.map(comment => ({
          ...comment,
          authorLiked: false
        }))
      }
    });
    next();
  } catch (error) {
    console.error('Error in getEntityThread:', error);
    next(error);
  }
};

exports.getEntityReplies = async (req, res, next) => {
  try {
    const { entity, commentId } = req.params;
    const { lastCommentId } = req.query;
    const author = req?.user?.author ?? null;
    const cid = req.cid;

    const parsedLimit = LIMIT_COMMENTS;
    const baseCacheKey = `cid:${cid}:thread:${entity}:${commentId}:limit:${parsedLimit}:last:${lastCommentId || 'none'}:anonymous`;
    const userCacheKey = author ? `cid:${cid}:thread:${entity}:${commentId}:limit:${parsedLimit}:last:${lastCommentId || 'none'}:user:${author}` : null;

    if (!mongoose.Types.ObjectId.isValid(entity) || !mongoose.Types.ObjectId.isValid(commentId)) {
      return res.status(400).json({ message: 'Invalid entity or comment ID.' });
    }

    if (author && userCacheKey) {
      const cachedUserData = await cacheService.get(userCacheKey);
      if (cachedUserData) {
        console.log('⚡ User-specific data obtained from cache');
        return res.status(200).json(cachedUserData);
      }
    }

    const cachedAnonData = await cacheService.get(baseCacheKey);
    if (cachedAnonData && !author) {
      console.log('⚡ Anonymous data obtained from cache');
      return res.status(200).json(cachedAnonData);
    }

    const postExists = await Post.exists({ entity, cid, 'deletion.status': 'active' });
    if (!postExists) {
      return res.status(404).json({ message: 'Post not found.' });
    }

    const parentComment = await Comment.findOne({
      _id: commentId,
      post: postExists._id,
      visible: true
    }).lean();

    if (!parentComment) {
      return res.status(404).json({ message: 'Comment not found or not visible.' });
    }

    const repliesQuery = {
      parent: commentId,
      visible: true
    };

    if (lastCommentId) {
      repliesQuery._id = { $lt: lastCommentId };
    }

    const replies = await Comment.find(repliesQuery)
      .sort({ _id: -1 })
      .limit(parsedLimit + 1)
      .lean();

    const hasMore = replies.length > parsedLimit;
    const paginatedReplies = hasMore ? replies.slice(0, parsedLimit) : replies;

    const profileMap = await getProfilesForComments(paginatedReplies, await getSessionUserId(author, cid), cid);

    const formattedReplies = paginatedReplies.map(reply => {
      return formatComment({
        ...reply,
        replies_visibles: reply.repliesCount || 0
      }, profileMap[reply.author], author);
    });

    const totalVisibleReplies = await Comment.countDocuments({
      parent: commentId,
      visible: true
    });

    const response = {
      entity,
      commentId,
      comments: {
        list: formattedReplies,
        totalReplies: totalVisibleReplies,
        hasMore,
        lastCommentId: paginatedReplies.length > 0
          ? paginatedReplies[paginatedReplies.length - 1]._id
          : null,
      },
    };

    await cacheService.set(baseCacheKey, {
      ...response,
      comments: {
        ...response.comments,
        list: response.comments.list.map(comment => ({
          ...comment,
          authorLiked: false
        }))
      }
    }, 3600);

    if (author && userCacheKey) {
      await cacheService.set(userCacheKey, response, 3600);
    }

    res.status(200).json(author ? response : {
      ...response,
      comments: {
        ...response.comments,
        list: response.comments.list.map(comment => ({
          ...comment,
          authorLiked: false
        }))
      }
    });
    next();
  } catch (error) {
    next(error);
  }
};

exports.getPostStats = async (req, res, next) => {
  try {
    const { entities, mapping } = req.query;
    const author = req?.user?.author || '';
    const cid = req.cid;
    const modeDiscovery = req.clientConfig?.modeDiscovery || false;

    if (!entities) {
      return res.status(400).json({ message: 'A valid entities array is required.' });
    }

  let parsedEntities, parsedMapping = {};
    try {
      parsedEntities = JSON.parse(entities);
      if (mapping) parsedMapping = JSON.parse(mapping);
    } catch (error) {
      return res.status(400).json({ message: 'Invalid format. Expected JSON array for entities and JSON object for mapping.' });
    }

    if (!Array.isArray(parsedEntities) || parsedEntities.length === 0) {
      return res.status(400).json({ message: 'A valid entities array is required.' });
    }

    // Stats - Increase views even in discovery mode
    await incrementPostViews(cid, parsedEntities);

    const cacheKey = `cid:${cid}:postStats:${parsedEntities.join(':')}`;
    const cachedStats = await cacheService.get(cacheKey);
    if (cachedStats) {
      return res.status(200).json( { posts: cachedStats, status: 'ok' } );
    }

    const posts = await Post.find({ entity: { $in: parsedEntities }, cid })
      .select(`
        entity 
        likes 
        likesCount
        sharesCount
        commentCount
        viewsCount
        config.comment_status
        config.visibility
        config.interaction
        config.limits
        config.editing
        config.language
        config.modeDiscovery
      `);

    const existingEntities = posts.map(post => post.entity.toString());

    const missingEntities = parsedEntities.filter(entity => 
      !existingEntities.includes(entity.toString())
    );

    const createdEntities = [];

    // If we are in discovery mode, create real posts for the missing entities
    if (modeDiscovery && missingEntities.length > 0) {
      await Promise.all(missingEntities.map(async (entity) => {
        await Post.createDiscoveryPost(entity, cid, parsedMapping[entity] || '');
        createdEntities.push(entity);
      }));
      
      // Re-search posts to include newly created ones
      const updatedPosts = await Post.find({ entity: { $in: parsedEntities }, cid })
        .select(`
          entity 
          likes 
          likesCount
          sharesCount
          commentCount
          viewsCount
          config.visibility
          config.comment_status
          config.interaction
          config.limits
          config.editing
          config.language
          config.modeDiscovery
        `);
      
      posts.push(...updatedPosts.filter(post => 
        missingEntities.includes(post.entity.toString())
      ));
    }

    // Get bookmarks for the authenticated user
    let bookmarks = [];
    if (author && posts.length > 0) {
      const profile = await Profile.findOne({ author, cid });
      if (profile) {
        bookmarks = await ProfileBookmark.find({
          profile_id: profile._id,
          post_id: { $in: posts.map(post => post._id) }
        }).select('post_id');
      }
    }

    const bookmarkMap = {};
    bookmarks.forEach(bookmark => {
      bookmarkMap[bookmark.post_id.toString()] = true;
    });

    const result = posts.map(post => ({
      entity: post.entity,
      likesCount: post.likesCount || 0,
      sharesCount: post.sharesCount || 0,
      commentsCount: post.commentCount || 0,
      viewsCount: post.viewsCount || 0,
      authorLiked: author ? (post.likes || []).includes(author) : false,
      authorBookmarked: author && post._id && bookmarkMap[post._id.toString()] ? true : false,
      config: {
        visibility: post.config?.visibility || 'public',
        comment_status: post.config?.comment_status || 'open',
        interaction: {
          allow_comments: post.config?.interaction?.allow_comments ?? true,
          allow_likes: post.config?.interaction?.allow_likes ?? true,
          allow_shares: post.config?.interaction?.allow_shares ?? true,
          allow_replies: post.config?.interaction?.allow_replies ?? true,
          allow_view_comments: post.config?.interaction?.allow_view_comments ?? true,
          allow_bookmarks: post.config?.interaction?.allow_bookmarks ?? false,
        },
        limits: {
          comment_text: post.config?.limits?.comment_text ?? 200,
          reply_text: post.config?.limits?.reply_text ?? 200,
        },
        editing: {
          allow_edits: post.config?.editing?.allow_edits ?? true,
          edit_time_limit: post.config?.editing?.edit_time_limit ?? 5,
          allow_delete: post.config?.editing?.allow_delete ?? true,
        },
        language: {
          post_language: post.config?.language?.post_language ?? 'es',
          auto_translate: post.config?.language?.auto_translate ?? true,
        },
        modeDiscovery: post.config?.modeDiscovery ?? false
      },
      // Indicar si este post fue recién creado en modeDiscovery
      isNewDiscovery: createdEntities.includes(post.entity.toString())
    }));

    if (!modeDiscovery) {
      await cacheService.set(cacheKey, result, 10);
    }
    
    res.status(200).json({ posts: result,  status: 'ok' });
    next();
  } catch (error) {
    console.error('Error in getPostStats:', error);
    next(error);
  }
};

exports.getPostLikes = async (req, res, next) => {
  try {
    const { entity } = req.params;
    const cid = req.cid;
    const author = req?.user?.author || null;
    const limit = 100;

    if (!mongoose.Types.ObjectId.isValid(entity)) {
      return res.status(400).json({ message: 'Invalid entity ID.' });
    }

    const cacheKey = `cid:${cid}:postLikes:${entity}`;
    let response = await cacheService.get(cacheKey);
    if (response) {
      console.log('⚡ Post likes obtained from cache');
      response.likes = await enrichLikesWithFollowStatus(response.likes, author, cid);
      return res.status(200).json(response);
    }

    const post = await Post.findOne({  entity,  cid, 'deletion.status': 'active'  }).select('likes likesCount viewsCount');
    
    if (!post) {
      return res.status(404).json({ message: 'Post not found.' });
    }

    const likes = post.likes.slice(-limit);
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
        // Verificar relaciones
        [isFollowing, isFollower, isFollowRequestSent] = await Promise.all([
          ProfileFollowing.exists({ profile_id: currentProfile._id, following_id: profile._id }),
          ProfileFollower.exists({ profile_id: profile._id,follower_id: currentProfile._id }),
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

    response = {
      totalLikes: post.likesCount || 0,
      viewsCount: post.viewsCount || 0,
      displayedLikes: formattedLikes.length,
      likes: formattedLikes
    };

    await cacheService.set(cacheKey, response, 3600);

    res.status(200).json(response);
    next();
  } catch (error) {
    console.error("❌ Error getting post likes:", error);
    next(error);
  }
};

exports.likePost = async (req, res, next) => {
  try {
    const { entity } = req.params;
    const author = req.user.author;
    const cid = req.cid;

    if (!mongoose.Types.ObjectId.isValid(entity)) {  return res.status(400).json({ message: 'Invalid entity ID.' }); }

    const post = await Post.findOne({ entity, cid, 'deletion.status': 'active' });
    if (!post) { return res.status(404).json({ message: 'Post not found.' }); }

    const { interaction } = post.config;
    if (!interaction.allow_likes) { return res.status(403).json({ message: 'Likes are not allowed for this post.' }); }

    const profile = await Profile.ensureProfileExists(req.user, req.cid, req.geoData || null);

    const existingLike = await ProfileLike.findOne({ profile_id: profile._id,  fk_id: post._id, fk_type: 'post' });

    if (existingLike) {
      await existingLike.deleteOne();
      await Post.removeLike(post._id, author);

      await cacheService.delete(`cid:${cid}:postLikes:${entity}`);
      await profileService.deleteProfileCache(cid, author);
      await recordActivityHit(`activity:likes:${cid}`, `removed`);

      return res.status(200).json({  liked: false, likesCount: post.likesCount - 1, message: 'Like removed.' });
    } else {
      await ProfileLike.create({ profile_id: profile._id, fk_id: post._id,fk_type: 'post', created_at: Date.now() });

      await Post.addLike(post._id, author);

      await cacheService.delete(`cid:${cid}:postLikes:${entity}`);
      await profileService.deleteProfileCache(cid, author);
      await recordGeoActivity(req, 'like');
      await recordActivityHit(`activity:likes:${cid}`, `added`);

      await activityService.logActivity({
        author: { _id: profile._id, username: profile.name, picture: profile.picture },
        actionType: 'like',
        target: { id: post._id, type: 'post', preview: post.description?.substring(0, 50) + '...' },
        references: { entity: post.entity },
      });

      res.status(200).json({ liked: true, likesCount: post.likesCount + 1, message: 'Like added.' });
      next();
    }
  } catch (error) {
    console.error("❌ Error in likePost:", error);
    next(error);
  }
};

exports.sharePost = async (req, res, next) => {
  try {
    const { entity } = req.params;
    const author = req?.user?.author || null;
    const cid = req.cid;

    if (!mongoose.Types.ObjectId.isValid(entity)) {
      return res.status(400).json({ message: 'Invalid entity ID.' });
    }

    const post = await Post.findOne({ entity, cid, 'deletion.status': 'active' });
    if (!post) { return res.status(404).json({ message: 'Post not found.' }); }

    const { interaction } = post.config;
    if (!interaction.allow_shares) { return res.status(403).json({ message: 'Shares are not allowed for this post.' }); }

    await Post.addShare(post._id);

    let profile = null;
    if (author) {
      profile = await profileService.getProfile(author, cid);
      if (!profile) { return res.status(404).json({ message: 'Profile not found.' }); }
      await ProfileShare.create({ profile_id: profile._id, post_id: post._id, created_at: Date.now() });
      await activityService.logActivity({
        author: { _id: profile._id, username: profile.name, picture: profile.picture },
        actionType: 'share',
        target: { id: post._id, type: 'post', preview: post.description?.substring(0, 50) + '...' },
        references: { entity: post.entity },
      });
      await profileService.deleteProfileCache(cid, author);
    }

    await recordGeoActivity(req, 'share');
    await recordActivityHit(`activity:shares:${cid}`, `added`);

    res.status(200).json({   message: 'Post shared successfully.',   sharesCount: post.sharesCount + 1 });
    next();
  } catch (error) {
    console.error("❌ Error sharing post:", error);
    next(error);
  }
};

/**
 * Retrieves and analyzes comments for a specific post entity
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {Promise<void>}
 */
exports.getCommentAnalysis = async (req, res, next) => {
  try {
    const { entity } = req.params;
    const bypassCache = false;  //Just for testing
    const cid = req.cid;
    const author = req?.user?.author ?? null;

    if (!mongoose.Types.ObjectId.isValid(entity)) {
      return res.status(400).json({ message: 'Invalid entity ID' });
    }

    const targetLanguage = await getUserLanguage(author, cid);
    const cacheKeys = {
      base: `cid:${cid}:commentAnalysis:${entity}`,
      translated: `cid:${cid}:commentAnalysis:${entity}:${targetLanguage}`
    };

    // Check cache unless bypassed for testing
    if (!bypassCache) {
      const cachedAnalysis = await getCachedAnalysis(cacheKeys, targetLanguage);
      if (cachedAnalysis) {
        const updatedAnalysis = await updateAuthorLikes(cachedAnalysis, author);
        return res.status(200).json({ analysis: updatedAnalysis });
      }
    }

    // Fetch post and validate
    const post = await Post.findOne({ 
      entity, 
      cid,
      'deletion.status': 'active' 
    }).select('title description commentCount').lean();
    
    if (!post) {
      return res.status(404).json({ message: 'Post not found' });
    }

    // Get previous analysis and new comments
    const previousAnalysisDoc = await CommentAnalysis.findOne({ cid, entity }).lean();
    const commentQuery = buildCommentQuery(post._id, previousAnalysisDoc);
    const newComments = await Comment.find(commentQuery)
      .select('_id text repliesCount likesCount created_at author')
      .sort({ created_at: -1 })
      .limit(100)
      .lean();

    // Perform analysis
    const analysisResult = await commentAnalysisService(
      cid,
      post.title || 'Untitled',
      post.description || '',
      newComments,
      previousAnalysisDoc?.analysis
    );

    // Ensure analysisResult.analysis exists
    const analysis = analysisResult.analysis ?? {};

    // Process highlighted comments
    const formattedAnalysis = await processHighlightedComments(
      analysis,
      newComments,
      author,
      cid
    );

    // Handle translation if needed
    const finalAnalysis = await handleTranslation(
      formattedAnalysis,
      targetLanguage,
      cacheKeys
    );

    // Update database and cache
    if (
      finalAnalysis?.analysis?.highlightedComments &&
      finalAnalysis.analysis.highlightedComments.length > 0
    ) {
      await updateCommentAnalysis(cid, entity, finalAnalysis);
    }

    await cacheAnalysis(cacheKeys, finalAnalysis, targetLanguage);

    return res.status(200).json({ analysis: finalAnalysis });

  } catch (error) {
    console.error('Error in getCommentAnalysis:', error);
    next(error);
  }
};