// ./controllers/clientController.js
const mongoose = require('mongoose');
const User = require('../models/User');
const Profile = require('../models/Profile');
const Post = require('../models/Post');
const Comment  = require('../models/Comment');
const os = require('os');
const { decryptJSON, generateKeyFromString } = require('../utils/cipher');
const clientConfigService = require('../services/clientConfigService');
const puppeteerService = require('../services/puppeteerService');
const { getLogs } = require('../services/loggerService');
const { cacheClient } = require('../services/cacheService');

exports.upsertClient = async (req, res) => {
  try {
    const userId = req.user._id;
    const { 
      cid,
      description,
      apiUrl,
      config,
      postConfig,
      vapid,
      email,
      configEncrypted = config,
      postConfigEncrypted = postConfig,
      vapidEncrypted = vapid,
      emailEncrypted = email
    } = req.body;

    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Valid description is required' 
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ 
        success: false,
        error: 'User not found' 
      });
    }

    const decryptionKey = cid ? generateKeyFromString(cid) : null;

    const decryptField = (encryptedData) => {
      if (!encryptedData) return null;
      if (!decryptionKey) return encryptedData;
      try {
        return typeof encryptedData === 'string' 
          ? decryptJSON(encryptedData, decryptionKey) 
          : encryptedData;
      } catch (error) {
        throw new Error(`Failed to decrypt field: ${error.message}`);
      }
    };

    let finalConfig = { modeDiscovery: false };
    let finalPostConfig = null;
    let finalVapid = null;
    let finalEmail = null;

    try {
      if (configEncrypted) finalConfig = { ...decryptField(configEncrypted), modeDiscovery: false };
      if (postConfigEncrypted) finalPostConfig = decryptField(postConfigEncrypted);
      if (vapidEncrypted) finalVapid = decryptField(vapidEncrypted);
      if (emailEncrypted) finalEmail = decryptField(emailEncrypted);
    } catch (error) {
      return res.status(400).json({ 
        success: false,
        error: error.message 
      });
    }

    const client = await user.updateCID(
      cid || await user.addClient(description.trim()),
      description.trim(),
      apiUrl || '',
      finalConfig,
      finalPostConfig,
      finalVapid,
      finalEmail
    );

    if (cid) await clientConfigService.clearClientConfigCache(cid);
    
    return res.json({ 
      success: true,
      message: 'Client updated successfully',
      client
    });

  } catch (error) {
    const statusCode = error.message.includes('not found') ? 404 : 
                     error.code === 11000 ? 409 : 500;
    res.status(statusCode).json({ 
      success: false,
      error: error.message || 'Internal server error' 
    });
  }
};

exports.getUsersByClient = async (req, res, next) => {
  try {
    const { 
      cid,
      page = 1, 
      limit = 10, 
      search = '',
      sort = 'created_at',
      order = 'desc'
    } = req.query;

    // Validate clientId
    if (!cid) {
      return res.status(400).json({ 
        success: false, 
        error: 'Client ID is required' 
      });
    }

    // Build query
    const query = { cid: cid };

    // Add search filter
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { given_name: { $regex: search, $options: 'i' } },
        { family_name: { $regex: search, $options: 'i' } }
      ];
    }

    // Pagination
    const pageNumber = parseInt(page);
    const limitNumber = parseInt(limit);
    const skip = (pageNumber - 1) * limitNumber;

    // Sort
    const sortOptions = {};
    sortOptions[sort] = order === 'desc' ? -1 : 1;

    // Execute queries
    const [users, totalUsers] = await Promise.all([
      Profile.find(query)
        .select('cid author name given_name family_name email picture locale bookmarksCount commentsCount followersCount followingCount likesCount sharesCount settings pushSubscriptions location geohash lastActivityViewed created_at updated_at')
        .sort(sortOptions)
        .skip(skip)
        .limit(limitNumber)
        .lean(),
      Profile.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: {
        users,
        pagination: {
          totalItems: totalUsers,
          totalPages: Math.ceil(totalUsers / limitNumber),
          currentPage: pageNumber,
          itemsPerPage: limitNumber,
          hasNext: pageNumber < Math.ceil(totalUsers / limitNumber),
          hasPrevious: pageNumber > 1
        }
      }
    });

  } catch (error) {
    next(error);
  }
};

exports.getPostComments = async (req, res, next) => {
  try {
    const { postId } = req.params;
    const currentUser = req.user?.username || '';
    const { 
      page = 1, 
      limit = 10, 
      search, 
      author,
      lastCommentId
    } = req.query;

    // Basic validation
    if (!mongoose.Types.ObjectId.isValid(postId)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid post ID format' 
      });
    }

    // Find the post (just to verify existence and get configuration)
    const post = await Post.findOne({
      _id: postId,
      'deletion.status': 'active'
    }).select('description config.interaction.allow_comments config.moderation.enable_toxicity_filter config.visibility config.moderation.banned_words config.moderation.enable_content_moderation config.moderation.moderation_prompt');

    if (!post) {
      return res.status(404).json({ 
        success: false, 
        error: 'Post not found' 
      });
    }

    // Build comment query
    const commentQuery = {
      post: postId,
      parent: null, // Only main comments
      visible: true
    };

    // Additional filters
    if (search) {
      commentQuery.text = { $regex: search, $options: 'i' };
    }

    if (author) {
      commentQuery.author = author;
    }

    if (lastCommentId && mongoose.Types.ObjectId.isValid(lastCommentId)) {
      commentQuery._id = { $lt: new mongoose.Types.ObjectId(lastCommentId) };
    }

    // Pagination
    const pageNumber = parseInt(page);
    const limitNumber = parseInt(limit);
    const skip = (pageNumber - 1) * limitNumber;

    // Get main comments
    const [comments, totalComments] = await Promise.all([
      Comment.find(commentQuery)
        .sort({ _id: -1 })
        .skip(skip)
        .limit(limitNumber)
        .lean(),
      Comment.countDocuments(commentQuery)
    ]);

    // Get author profiles
    const authorIds = comments.map(c => c.author);
    const profiles = await Profile.find({ author: { $in: authorIds } })
      .select('author name given_name family_name picture locale created_at');
    
    const profileMap = profiles.reduce((map, profile) => {
      map[profile.author] = profile;
      return map;
    }, {});

    // Format comments
    const formattedComments = await Promise.all(
      comments.map(async comment => {
        const profile = profileMap[comment.author];
        const formatted = formatComment({
          ...comment,
          replies_visibles: comment.repliesCount || 0
        }, profile, currentUser);

        // Get some recent replies (optional)
        if (comment.repliesCount > 0) {
          const recentReplies = await Comment.find({
            parent: comment._id,
            visible: true
          })
          .sort({ _id: -1 })
          .limit(2)
          .lean();

          formatted.replies = await Promise.all(
            recentReplies.map(async reply => {
              const replyProfile = profileMap[reply.author] || 
                await Profile.findOne({ author: reply.author })
                  .select('author name given_name family_name picture locale created_at');
              return formatComment(reply, replyProfile, currentUser);
            })
          );
        }

        return formatted;
      })
    );

    res.status(200).json({
      success: true,
      data: {
        comments: formattedComments,
        postConfig: {
          allowComments: post.config.interaction.allow_comments,
          toxicityFilter: post.config.moderation.enable_toxicity_filter,
          description: post.description,
          visibility: post.config.visibility,
          banned_words: post.config.moderation.banned_words,
          enable_content_moderation: post.config.moderation.enable_content_moderation,
          moderation_prompt: post.config.moderation.moderation_prompt
        },
        pagination: {
          totalItems: totalComments,
          totalPages: Math.ceil(totalComments / limitNumber),
          currentPage: pageNumber,
          itemsPerPage: limitNumber,
          hasNext: pageNumber < Math.ceil(totalComments / limitNumber),
          hasPrevious: pageNumber > 1,
          lastCommentId: comments.length > 0 ? comments[comments.length - 1]._id : null
        }
      }
    });

  } catch (error) {
    next(error);
  }
};

exports.upsertPost = async (req, res, next) => {
  try {
    const { config, description, entity, ...otherFields } = req.body;
    const cid = req.cid;

    if (!mongoose.Types.ObjectId.isValid(entity)) {
      return res.status(400).json({ message: 'Invalid entity ID.' });
    }

    const defaultPostConfig = Post.schema.path('config').defaultValue;
    const finalConfig = deepMerge(JSON.parse(JSON.stringify(defaultPostConfig)), config || {});

    const postData = {
      entity,
      cid,
      config: finalConfig,
      description,
      updated_at: new Date(),
      ...otherFields
    };

    const updatedPost = await Post.findOneAndUpdate(
      { entity },
      postData,
      { 
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    );

    const message = updatedPost.created_at === updatedPost.updated_at 
      ? 'Post successfully created.' 
      : 'Post successfully updated.';

    res.status(200).json({ message, post: updatedPost });
  } catch (error) {
    next(error);
  }
};

exports.trashPost = async (req, res, next) => {
  try {
    const { cid, entity } = req.body;
    const adminId = req.user && req.user._id;

    if (!mongoose.Types.ObjectId.isValid(entity)) {
      return res.status(400).json({ message: 'Invalid entity ID.' });
    }

    const postObject = await Post.findOne({ cid, entity, 'deletion.status': 'active' });

    if (!postObject) {
      return res.status(404).json({ message: 'Post not found or already deleted.' });
    }

    await Post.moveToTrash(postObject._id, adminId);

    res.status(200).json({ success: true, message: 'Post moved to trash successfully.', postObject });
  } catch (error) {
    next(error);
  }
};

exports.restorePostFromTrash = async (req, res, next) => {
  try {
    const { cid, entity } = req.body;

    if (!mongoose.Types.ObjectId.isValid(entity)) {
      return res.status(400).json({ message: 'Invalid entity ID.' });
    }

    const postObject = await Post.findOne({ cid, entity, 'deletion.status': 'trash' });

    if (!postObject) {
      return res.status(404).json({ message: 'Post not found in trash or already active.' });
    }

    await Post.restoreFromTrash(postObject._id);

    res.status(200).json({ success: true, message: 'Post successfully restored from trash.', postObject });
  } catch (error) {
    next(error);
  }
};

exports.getClientPosts = async (req, res) => {
  try {
    const user = req.user;

    const { 
      page = 1, 
      limit = 10, 
      cid, 
      sort = 'created_at', 
      order = 'desc',
      search,
      category,
      visibility,
      dateFrom,
      dateTo,
      allowComments,
      allowLikes,
      deleted = 'false'
    } = req.query;

    // Validate pagination parameters
    const pageNumber = parseInt(page);
    const limitNumber = parseInt(limit);
    const skip = (pageNumber - 1) * limitNumber;

    if (isNaN(pageNumber) || isNaN(limitNumber) || pageNumber < 1 || limitNumber < 1) {
      return res.status(400).json({
        success: false,
        error: 'Invalid pagination parameters'
      });
    }

    // Build base query
    const query = {};
    
    if (!cid) {
      const clientIds = user.clients.map(client => client.cid);
      query.cid = { $in: clientIds };
    } else {
      const clientExists = user.clients.some(client => client.cid === cid);
      if (!clientExists) {
        return res.status(403).json({
          success: false,
          error: 'You do not have access to this client ID'
        });
      }
      query.cid = cid;
    }

    // Add filters
    if (search) {
      query.$or = [
        { reference: { $regex: search, $options: 'i' } },
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { 'config.tags': { $regex: search, $options: 'i' } },
        { 'config.category': { $regex: search, $options: 'i' } }
      ];
    }

    if (category) {
      query['config.category'] = { $regex: category, $options: 'i' };
    }

    if (visibility) {
      query['config.visibility'] = { $regex: new RegExp(`^${visibility}$`, 'i') };
    }

    if (dateFrom || dateTo) {
      query.created_at = {};
      if (dateFrom) {
        query.created_at.$gte = new Date(dateFrom);
      }
      if (dateTo) {
        query.created_at.$lte = new Date(dateTo);
      }
    }

    if (allowComments !== undefined) {
      query['config.interaction.allow_comments'] = allowComments === 'true';
    }
    if (allowLikes !== undefined) {
      query['config.interaction.allow_likes'] = allowLikes === 'true';
    }

    query['deletion.status'] = deleted === 'true' ? 'trash' : 'active';

    // Build sort options
    const sortOrder = order === 'asc' ? 1 : -1;
    const sortOptions = { [sort]: sortOrder };

    // Query database
    const [posts, total] = await Promise.all([
      Post.find(query)
        .sort(sortOptions)
        .skip(skip)
        .limit(limitNumber)
        .lean(),
      Post.countDocuments(query)
    ]);

    // Get comment counts for each post
    const postIds = posts.map(post => post._id);
    const commentCounts = await Comment.aggregate([
      {
        $match: {
          post: { $in: postIds },
          visible: true,
          parent: null
        }
      },
      {
        $group: {
          _id: "$post",
          count: { $sum: 1 }
        }
      }
    ]);

    // Transform posts
    const transformedPosts = posts.map(post => ({
      ...post,
      commentsCount: post.commentCount || 0,
      likesCount: post.likesCount || 0,
      sharesCount: post.sharesCount || 0
    }));

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / limitNumber);
    const hasNext = pageNumber < totalPages;
    const hasPrevious = pageNumber > 1;

    res.json({
      success: true,
      data: {
        posts: transformedPosts,
        pagination: {
          totalItems: total,
          totalPages,
          currentPage: pageNumber,
          itemsPerPage: limitNumber,
          hasNext,
          hasPrevious,
          filters: {
            search,
            category,
            visibility,
            dateFrom,
            dateTo,
            allowComments,
            allowLikes
          }
        }
      }
    });

  } catch (error) {
    console.error('Error fetching client posts:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.moderationTest = async (req, res) => {
  try {
    const { cid, text, config } = req.body;
    console.log(`🔎 Moderating content for CID: ${cid}`);
    const { moderateService } = require('../services/moderateService');
    const { isRejected, reason } = await moderateService(cid, text, config);
    console.log(`✅ Moderation complete: ${isRejected ? 'Rejected' : 'Approved'}`);

    res.json({ 
      success: true,
      isApproved: !isRejected,
      reason: reason
    });
  } catch (error) {
    console.error('🚫 Error in moderationTest:', error);
    const statusCode = error.message.includes('CID not found') ? 404 : 500;
    res.status(statusCode).json({ 
      success: false,
      error: error.message || 'Internal error' 
    });
  }
};

exports.deleteClient = async (req, res, next) => {
  try {
    const { cid } = req.params;
    const userId = req.user._id;

    // Validate CID format
    if (!/^QU-[A-Z0-9]{8}-[A-Z0-9]{5}$/.test(cid)) {
      return res.status(400).json({ success: false, error: 'Invalid CID format' });
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Check if client exists
    const clientIndex = user.clients.findIndex(client => client.cid === cid);
    if (clientIndex === -1) {
      return res.status(404).json({ success: false, error: 'Client not found' });
    }

    // Check if client has associated posts
    const postCount = await Post.countDocuments({ cid });
    if (postCount > 0) {
      return res.status(400).json({ success: false, error: 'Cannot delete client with associated posts' });
    }

    // Remove client
    user.clients.splice(clientIndex, 1);
    await user.save();

    // Clear cache
    await clientConfigService.clearClientConfigCache(cid);

    res.status(200).json({ success: true, message: 'Client deleted successfully' });
  } catch (error) {
    console.error('Error in deleteClient:', error);
    res.status(500).json({ success: false, error: 'Internal server error'});
  }
};

exports.testDiscovery = async (req, res, next) => {
  const { url } = req.query;

  try {
    if (!url) {
      console.warn('⚠️ URL parameter is required');
      return res.status(400).json({ success: false, error: "URL parameter is required" });
    }

    console.log(`🌐 Attempting to scrape URL: ${url}`);
    const result = await puppeteerService.scrapePageData(url);
    await puppeteerService.closeBrowser();
    console.log('✅ Page scraped successfully');
    
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('🔍 Error in testDiscovery:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getMonitoring = async (req, res) => {
  const { from, level } = req.query;
  let logs = getLogs();
  if (from) {
    const fromDate = new Date(from);
    if (!isNaN(fromDate)) {
      logs = logs.filter(log => new Date(log.time) > fromDate);
    }
  }

  if (level) {
    logs = logs.filter(log => log.level.toLowerCase() === level.toLowerCase());
  }

  const appStats = {
      system: {
        cpus: os.cpus().length,
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        loadAvg: os.loadavg(),
        uptime: os.uptime()
      },
      process: {
        memoryUsage: process.memoryUsage(),
        uptime: process.uptime(),
        version: process.version
      }
    };

    const db = mongoose.connection.db;
    const [dbStats, serverStatus, redisInfo] = await Promise.all([
      db.stats(),
      db.admin().serverStatus(),
      cacheClient.info()
    ]);

    const mongoStats = {
      connections: serverStatus.connections,
      operations: serverStatus.opcounters,
      memory: serverStatus.mem,
      storage: {
        total: dbStats.storageSize,
        data: dbStats.dataSize,
        indexes: dbStats.indexSize
      },
      version: serverStatus.version
    };

    const db0Stats = {  keys: await cacheClient.dbSize() }
    const redisStats = {};

    redisInfo.split('\r\n').forEach(line => {
      if (line && !line.startsWith('#')) {
        const [key, value] = line.split(':');
        if (key && value) {
          redisStats[key] = isNaN(value) ? value : Number(value);
        }
      }
    });

    res.status(200).json({
      success: true,
      data: {
        timestamp: new Date(),
        app: appStats,
        database: mongoStats,
        cache: {
          redis: redisStats,
          db0: db0Stats
        },
        logs
      }
    });
};