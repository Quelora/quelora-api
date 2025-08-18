const Profile = require('../models/Profile');
const ProfileFollower = require('../models/ProfileFollower');
const ProfileFollowing = require('../models/ProfileFollowing');
const ProfileFollowRequest = require('../models/ProfileFollowRequest');
const ProfileBlock = require('../models/ProfileBlock');
const ProfileLike = require('../models/ProfileLike');
const Comment = require('../models/Comment');
const ProfileShare = require('../models/ProfileShare');
const ProfileBookmark = require('../models/ProfileBookmark');

const { cacheClient, cacheService } = require('./cacheService');
const { validateSearchQuery } = require('../utils/textUtils');

/**
 * Generates the main cache key for a profile including options
 * @param {string} cid - Client ID
 * @param {string} author - Profile author ID
 * @param {Object} options - Query options
 * @returns {string} Cache key
 */
const generateMainCacheKey = (cid, author, options = {}) => {
  if (!cid || !author) throw new Error('CID and author are required for cache key');
  const {
    currentUser = null,
    includeRelations = false,
    includeCounts = false,
    includeSettings = false,
    includeActivity = false,
    includeBookmarks = false
  } = options;
  
  const optionsKey = [
    currentUser ? `cu:${currentUser}` : 'cu:none',
    `ir:${includeRelations}`,
    `ic:${includeCounts}`,
    `is:${includeSettings}`,
    `ia:${includeActivity}`,
    `ib:${includeBookmarks}`
  ].join(':');
  
  return `profile:${cid}:${author}:${optionsKey}`;
}

/**
 * Deletes cache keys for a profile
 * @param {string} cid - Client ID
 * @param {string} author - Profile author ID
 * @returns {Promise<void>}
 */
const deleteProfileCache = async (cid, author) => {
  if (!cid || !author) throw new Error('CID and author are required to delete cache');
  await cacheService.deleteByPattern(`profile:${cid}:${author}:*`);
  await cacheService.deleteByPattern(`following:${cid}:${author}:*`);
  await cacheService.deleteByPattern(`followers:${cid}:${author}:*`);
  await cacheService.deleteByPattern(`comments:${cid}:${author}:*`);
  await cacheService.deleteByPattern(`likes:${cid}:${author}:*`);
  await cacheService.deleteByPattern(`bookmarks:${cid}:${author}:*`);
  await cacheService.deleteByPattern(`shares:${cid}:${author}:*`);
}

/**
* Gets the profile with associated data (the single source of truth for the profile)
* @param {string} author - ID of the profile author
* @param {string} cid - ID of the client
* @returns {Promise<Object>} Full profile with all associated data
*/
const getSingleSourceOfTruthProfile = async (author, cid, fullProfile = false) => {
  return await getProfile(author, cid, {
    currentUser: author,
    payloadUser : fullProfile,
    includeRelations: true,
    includeSettings: fullProfile,
    includeCounts: fullProfile,
    includeActivity: fullProfile,
    includeBookmarks: fullProfile,
    includeNotifications: fullProfile,
    forceRefresh: true
  });
};

/**
 * Retrieves basic profile data and relations based on parameters
 * Single source of truth
 * @param {string} author - Profile author ID
 * @param {string} cid - Client ID 
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Profile data
 */
const getProfile = async (author, cid, options = {}) => {
  if (!author || !cid) throw new Error('Author and CID are required');

  const {
    currentUser = null,
    payloadUser = null,
    geoData = null,
    includeRelations = false,
    includeCounts = false,
    includeSettings = false,
    includeActivity = false,
    includeBookmarks = false,
    includeNotifications = false,
    forceRefresh = false
  } = options;

  const isSessionUser = currentUser && currentUser === author;
  const cacheKey = generateMainCacheKey(cid, author, { currentUser, includeRelations, includeCounts, includeSettings, includeActivity, includeBookmarks });
                                                      
  if (!isSessionUser && !forceRefresh) {
    const cachedProfile = await cacheClient.get(cacheKey);
    if (cachedProfile) return JSON.parse(cachedProfile);
  }
  
  let profile;
  if (isSessionUser && payloadUser) {
    profile = await Profile.ensureProfileExists(payloadUser, cid, options.geoData || null);
  } else {
    profile = await Profile.findOne({ author, cid }).lean();
    if (!profile) throw new Error('Profile not found');
  }

  let isFollowing = false;
  let isFollowRequestSent = false;

  const currentProfile = await Profile.findOne({ author: currentUser, cid }).select('_id').lean();

  if (currentProfile) {
    const followerCheck = await ProfileFollower.findOne({ profile_id: profile._id, follower_id: currentProfile._id }).lean();
    isFollowing = !!followerCheck;

    const followRequestCheck = await ProfileFollowRequest.findOne({ profile_id: currentProfile._id, target_id: profile._id, status: 'pending'}).lean();
    isFollowRequestSent = !!followRequestCheck;
  }
  
  const result = {
    _id: profile._id,
    author: profile.author,
    given_name: profile.given_name,
    family_name: profile.family_name,
    name: profile.name,
    picture: profile.picture,
    background: profile.background,
    locale: profile.locale,
    created_at: profile.created_at,
    updated_at: profile.updated_at,
    visibility: profile.settings?.privacy?.showActivity === 'onlyme' ? 'private' : 'public',
    followerApproval: profile.settings?.privacy?.followerApproval || false,
    isFollowing,
    isFollowRequestSent
  };

  if (isSessionUser && includeSettings) {
    result.settings = profile.settings;
  }

  if (isSessionUser && includeNotifications) {
    result.pushSubscriptions = profile.pushSubscriptions;
  }

  if (isSessionUser) {
    const followRequests = await ProfileFollowRequest.find({ 
      target_id: profile._id, 
      status: 'pending' 
    })
    .populate({
      path: 'profile_id', select: 'author name picture given_name family_name locale settings.privacy.showActivity settings.privacy.followerApproval',
      match: { cid } })
    .lean();

    result.followRequests = followRequests
      .filter(req => req.profile_id)
      .map(req => ({
        _id: req._id,
        requester: {
          _id: req.profile_id._id,
          author: req.profile_id.author,
          name: req.profile_id.name,
          picture: req.profile_id.picture,
          given_name: req.profile_id.given_name,
          family_name: req.profile_id.family_name,
          locale: req.profile_id.locale,
          visibility: req.profile_id.settings?.privacy?.showActivity === 'onlyme' ? 'private' : 'public',
          followerApproval: req.profile_id.settings?.privacy?.followerApproval || false
        },
        created_at: req.created_at
      }));
  }

  if (includeRelations) {
    const [followers, following, blocked] = await Promise.all([
      ProfileFollower.find({ profile_id: profile._id })
        .populate({
          path: 'follower_id',
          select: 'author name picture given_name family_name locale settings.privacy.showActivity settings.privacy.followerApproval',
          match: { cid }
        })
        .limit(25)
        .lean(),
      ProfileFollowing.find({ profile_id: profile._id })
        .populate({
          path: 'following_id',
          select: 'author name picture given_name family_name locale settings.privacy.showActivity settings.privacy.followerApproval',
          match: { cid }
        })
        .limit(25)
        .lean(),
      ProfileBlock.find({ blocker_id: profile._id }).select('blocked_author').lean()
    ]);

    const followerPromises = followers.filter(f => f.follower_id).map(async f => {
      let followerIsFollowing = false;
      let followerIsFollowRequestSent = false;
      if (currentUser && f.follower_id.author !== currentUser) {
        const currentProfile = await Profile.findOne({ author: currentUser, cid }).select('_id').lean();
        if (currentProfile) {
          const check = await ProfileFollower.findOne({ profile_id: f.follower_id._id, follower_id: currentProfile._id }).lean();
          followerIsFollowing = !!check;

          const followRequestCheck = await ProfileFollowRequest.findOne({ profile_id: currentProfile._id, target_id: f.follower_id._id, status: 'pending' }).lean();
          followerIsFollowRequestSent = !!followRequestCheck;
        }
      }
      return {
        _id: f.follower_id._id,
        author: f.follower_id.author,
        name: f.follower_id.name,
        picture: f.follower_id.picture,
        given_name: f.follower_id.given_name,
        family_name: f.follower_id.family_name,
        locale: f.follower_id.locale,
        visibility: f.follower_id.settings?.privacy?.showActivity === 'onlyme' ? 'private' : 'public',
        followerApproval: f.follower_id.settings?.privacy?.followerApproval || false,
        isFollowing: followerIsFollowing,
        isFollowRequestSent: followerIsFollowRequestSent
      };
    });

    const followingPromises = following.filter(f => f.following_id).map(async f => {
      let followingIsFollowing = false;
      let followingIsFollowRequestSent = false;
      if (currentUser && f.following_id.author !== currentUser) {
        const currentProfile = await Profile.findOne({ author: currentUser, cid }).select('_id').lean();
        if (currentProfile) {
          const check = await ProfileFollower.findOne({ profile_id: f.following_id._id, follower_id: currentProfile._id }).lean();
          followingIsFollowing = !!check;

          const followRequestCheck = await ProfileFollowRequest.findOne({ profile_id: currentProfile._id, target_id: f.following_id._id, status: 'pending' }).lean();
          followingIsFollowRequestSent = !!followRequestCheck;
        }
      }
      return {
        _id: f.following_id._id,
        author: f.following_id.author,
        name: f.following_id.name,
        picture: f.following_id.picture,
        given_name: f.following_id.given_name,
        family_name: f.following_id.family_name,
        locale: f.following_id.locale,
        visibility: f.following_id.settings?.privacy?.showActivity === 'onlyme' ? 'private' : 'public',
        followerApproval: f.following_id.settings?.privacy?.followerApproval || false,
        isFollowing: followingIsFollowing,
        isFollowRequestSent: followingIsFollowRequestSent
      };
    });

    result.followers = await Promise.all(followerPromises);
    result.following = await Promise.all(followingPromises);
    result.blocked = blocked;
  }

  if (includeActivity && (isSessionUser || profile.settings?.privacy?.showActivity === 'public' || (profile.settings?.privacy?.showActivity === 'followers' && isFollowing))) {
    const [likes, comments, shares] = await Promise.all([
      ProfileLike.find({ profile_id: profile._id }).lean(),
      Comment.find({ profile_id: profile._id, visible: true }).lean(),
      ProfileShare.find({ profile_id: profile._id }).lean()
    ]);

    result.activity = {
      likes: await processLikes(likes, cid),
      comments: await processComments(comments, cid),
      shares: await processShares(shares, cid)
    };
  }

  let bookmarks = [];
  if (includeBookmarks) {
    bookmarks = await ProfileBookmark.find({ profile_id: profile._id })
                                     .populate({
                                        path: 'post_id', select: 'title link description type created_at',
                                        options: { strictPopulate: false }
                                      })
                                     .sort({ created_at: -1 })
                                     .limit(25)
                                     .lean();

    result.bookmarks = bookmarks.filter(b => b.post_id)
                                .map(b => ({
                                  _id: b._id,
                                  post: {
                                    _id: b.post_id._id,
                                    title: b.post_id.title,
                                    link: b.post_id.link,
                                    description: b.post_id.description,
                                    type: b.post_id.type,
                                    created_at: b.post_id.created_at
                                  },
                                  created_at: b.created_at
                                }));
  }

  if (includeCounts) {
    result.counts = {
      followers: profile.followersCount || 0,
      following: profile.followingCount || 0,
      likes: profile.likesCount || 0,
      comments: profile.commentsCount || 0,
      shares: profile.sharesCount || 0,
      bookmarks: bookmarks.length
    };
  }

  if (!isSessionUser) {
    await cacheClient.set(cacheKey, JSON.stringify(result), 'EX', 300);
  }

  return result;
};


// Process likes with MongoDB aggregation pipeline
async function processLikes(items, cid) {
  const pipeline = [
    { $match: { _id: { $in: items.map(item => item._id) } } },
    { $sort: { created_at: -1 } },
    { $limit: 30 },
    {
      $lookup: {
        from: 'posts',
        let: { fkId: '$fk_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$_id', '$$fkId'] }, 'deletion.status': 'active' } },
          { $project: { title: 1, link: 1, description: 1, created_at: 1 } }
        ],
        as: 'post'
      }
    },
    {
      $lookup: {
        from: 'comments',
        let: { fkId: '$fk_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$_id', '$$fkId'] } } },
          { $project: { text: 1, author: 1, created_at: 1, post: 1 } },
          {
            $lookup: {
              from: 'posts',
              let: { postId: '$post' },
              pipeline: [
                { $match: { $expr: { $eq: ['$_id', '$$postId'] }, 'deletion.status': 'active' } },
                { $project: { title: 1, link: 1, description: 1, created_at: 1 } }
              ],
              as: 'referer'
            }
          },
          { $unwind: { path: '$referer', preserveNullAndEmptyArrays: true } },
          {
            $lookup: {
              from: 'profiles',
              let: { authorId: '$author' },
              pipeline: [
                { $match: { $expr: { $eq: ['$author', '$$authorId'] }, cid } },
                { $project: { author: 1, name: 1, picture: 1, family_name: 1, locale: 1, given_name: 1 } }
              ],
              as: 'authorProfile'
            }
          },
          { $unwind: { path: '$authorProfile', preserveNullAndEmptyArrays: true } },
          {
            $project: {
              text: 1,
              created_at: 1,
              post: 1,
              referer: { title: 1, link: 1, description: 1, created_at: 1 },
              author: {
                author: '$authorProfile.author',
                name: '$authorProfile.name',
                picture: '$authorProfile.picture',
                family_name: '$authorProfile.family_name',
                locale: '$authorProfile.locale',
                given_name: '$authorProfile.given_name'
              }
            }
          }
        ],
        as: 'comment'
      }
    },
    {
      $project: {
        fk_type: 1,
        created_at: 1,
        post: { $arrayElemAt: ['$post', 0] },
        comment: { $arrayElemAt: ['$comment', 0] }
      }
    },
    {
      $match: {
        $or: [
          { post: { $ne: null } },
          { comment: { $ne: null } }
        ]
      }
    }
  ];

  const likes = await ProfileLike.aggregate(pipeline);
  return likes.map(item => ({
    fk_type: item.fk_type,
    ...(item.post ? { ...item.post, madeAt: item.created_at } : {}),
    ...(item.comment ? {
      fk_type: 'comment',
      text: item.comment.text,
      created_at: item.comment.created_at,
      madeAt: item.created_at,
      author: item.comment.author || null,
      referer: item.comment.referer ? { ...item.comment.referer, title: item.comment.referer.title || item.comment.referer.description } : null
    } : {})
  })).filter(Boolean);
}

// Process comments with MongoDB aggregation pipeline
async function processComments(items, cid) {
  const pipeline = [
    { $match: { _id: { $in: items.map(item => item._id) } } },
    { $sort: { created_at: -1 } },
    { $limit: 30 },
    {
      $lookup: {
        from: 'posts',
        let: { postId: '$post' },
        pipeline: [
          { $match: { $expr: { $eq: ['$_id', '$$postId'] }, 'deletion.status': 'active' } },
          { $project: { title: 1, link: 1, description: 1, created_at: 1 } }
        ],
        as: 'referer'
      }
    },
    { $unwind: { path: '$referer', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'profiles',
        let: { authorId: '$author' },
        pipeline: [
          { $match: { $expr: { $eq: ['$author', '$$authorId'] }, cid } },
          { $project: { author: 1, name: 1, picture: 1, family_name: 1, locale: 1, given_name: 1 } }
        ],
        as: 'authorProfile'
      }
    },
    { $unwind: { path: '$authorProfile', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 1,
        text: 1,
        created_at: 1,
        madeAt: '$created_at',
        author: {
          author: '$authorProfile.author',
          name: '$authorProfile.name',
          picture: '$authorProfile.picture',
          family_name: '$authorProfile.family_name',
          locale: '$authorProfile.locale',
          given_name: '$authorProfile.given_name'
        },
        referer: {
          $cond: {
            if: { $eq: ['$referer', null] },
            then: null,
            else: {
              _id: '$referer._id',
              title: { $ifNull: ['$referer.title', '$referer.description'] },
              link: '$referer.link',
              description: '$referer.description',
              created_at: '$referer.created_at'
            }
          }
        }
      }
    },
    { $match: { referer: { $ne: null } } }
  ];

  const comments = await Comment.aggregate(pipeline);
  return comments.filter(Boolean);
}

// Process shares with MongoDB aggregation pipeline
async function processShares(items, cid) {
  const pipeline = [
    { $match: { _id: { $in: items.map(item => item._id) } } },
    { $sort: { created_at: -1 } },
    { $limit: 30 },
    {
      $lookup: {
        from: 'posts',
        let: { postId: '$post_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$_id', '$$postId'] }, 'deletion.status': 'active' } },
          { $project: { title: 1, link: 1, description: 1, type: 1, created_at: 1 } }
        ],
        as: 'post'
      }
    },
    { $unwind: { path: '$post', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        action_id: '$_id',
        madeAt: '$created_at',
        entity: {
          $cond: {
            if: { $eq: ['$post', null] },
            then: null,
            else: {
              _id: '$post._id',
              title: '$post.title',
              link: '$post.link',
              description: '$post.description',
              type: '$post.type',
              created_at: '$post.created_at'
            }
          }
        }
      }
    },
    { $match: { entity: { $ne: null } } }
  ];

  const shares = await ProfileShare.aggregate(pipeline);
  if (!shares.length && items.length) {
    console.warn(`No shares found for items:`, items);
  }
  return shares.filter(Boolean);
}

/**
 * Get following users with full profile data and follow status
 * @param {string} author - Profile author ID
 * @param {string} cid - Client ID
 * @param {string} query - Search query (optional)
 * @param {string} currentUser - Current user ID (optional)
 * @returns {Promise<Object>} Following users data
 */
const getMoreFollowing = async (author, cid, query = null, currentUser = null) => {
  const searchQuery = validateSearchQuery(query);
  const profile = await Profile.findOne({ author, cid }).lean();
  if (!profile) throw new Error('Profile not found');

  const cacheKey = `following:${cid}:${author}:${searchQuery || 'no-query'}`;
  const cachedFollowing = await cacheClient.get(cacheKey);
  if (cachedFollowing) return JSON.parse(cachedFollowing);

  const followerIds = (await ProfileFollower.find({ profile_id: profile._id }).select('follower_id').lean())
    .map(f => f.follower_id.toString());

  const currentProfile = currentUser ? await Profile.findOne({ author: currentUser, cid }).select('_id').lean() : null;

  const pipeline = [
    { $match: { profile_id: profile._id } },
    {
      $lookup: {
        from: 'profiles',
        localField: 'following_id',
        foreignField: '_id',
        as: 'followingProfile'
      }
    },
    { $unwind: '$followingProfile' },
    ...(searchQuery ? [{
      $match: {
        $or: [
          { 'followingProfile.name': { $regex: searchQuery, $options: 'i' } },
          { 'followingProfile.given_name': { $regex: searchQuery, $options: 'i' } },
          { 'followingProfile.family_name': { $regex: searchQuery, $options: 'i' } }
        ]
      }
    }] : []),
    {
      $lookup: {
        from: 'profilefollowrequests',
        let: { followingId: '$followingProfile._id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$profile_id', currentProfile ? currentProfile._id : null] },
                  { $eq: ['$target_id', '$$followingId'] },
                  { $eq: ['$status', 'pending'] }
                ]
              }
            }
          }
        ],
        as: 'followRequest'
      }
    },
    {
      $lookup: {
        from: 'profilefollowers',
        let: { followingId: '$followingProfile._id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$follower_id', currentProfile ? currentProfile._id : null] },
                  { $eq: ['$profile_id', '$$followingId'] }
                ]
              }
            }
          }
        ],
        as: 'follower'
      }
    },
    { $sort: { _id: -1 } },
    { $limit: 25 },
    {
      $project: {
        _id: 1,
        author: '$followingProfile.author',
        name: '$followingProfile.name',
        picture: '$followingProfile.picture',
        family_name: '$followingProfile.family_name',
        locale: '$followingProfile.locale',
        given_name: '$followingProfile.given_name',
        created_at: 1,
        isFollower: { $in: ['$followingProfile._id', followerIds] },
        isFollowing: { $gt: [{ $size: '$follower' }, 0] },
        isFollowRequestSent: { $gt: [{ $size: '$followRequest' }, 0] }
      }
    }
  ];

  const following = await ProfileFollowing.aggregate(pipeline);

  if (currentUser && currentUser !== author && currentProfile) {
    for (const user of following) {
      const isFollowing = await ProfileFollowing.exists({
        profile_id: currentProfile._id,
        following_id: user._id
      });
      user.isFollowingCurrentUser = !!isFollowing;
    }
  }

  const response = {
    status: 'ok',
    result: following,
    has_more: following.length === 25,
    last_id: following.length > 0 ? following[following.length - 1]._id : null
  };

  await cacheClient.set(cacheKey, JSON.stringify(response), 'EX', 600);
  return response;
};

/**
 * Get followers with full profile data and follow status
 * @param {string} author - Profile author ID
 * @param {string} cid - Client ID
 * @param {string} query - Search query (optional)
 * @param {string} currentUser - Current user ID (optional)
 * @returns {Promise<Object>} Followers data
 */
const getMoreFollowers = async (author, cid, query = null, currentUser = null) => {
  const searchQuery = validateSearchQuery(query);
  const profile = await Profile.findOne({ author, cid }).lean();
  if (!profile) throw new Error('Profile not found');

  const cacheKey = `followers:${cid}:${author}:${searchQuery || 'no-query'}`;
  const cachedFollowers = await cacheClient.get(cacheKey);
  if (cachedFollowers) return JSON.parse(cachedFollowers);

  const followingIds = (await ProfileFollowing.find({ profile_id: profile._id }).select('following_id').lean())
    .map(f => f.following_id.toString());

  const currentProfile = currentUser ? await Profile.findOne({ author: currentUser, cid }).select('_id').lean() : null;

  const pipeline = [
    { $match: { profile_id: profile._id } },
    {
      $lookup: {
        from: 'profiles',
        localField: 'follower_id',
        foreignField: '_id',
        as: 'followerProfile'
      }
    },
    { $unwind: '$followerProfile' },
    ...(searchQuery ? [{
      $match: {
        $or: [
          { 'followerProfile.name': { $regex: searchQuery, $options: 'i' } },
          { 'followerProfile.given_name': { $regex: searchQuery, $options: 'i' } },
          { 'followerProfile.family_name': { $regex: searchQuery, $options: 'i' } }
        ]
      }
    }] : []),
    {
      $lookup: {
        from: 'profilefollowrequests',
        let: { followerId: '$followerProfile._id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$profile_id', currentProfile ? currentProfile._id : null] },
                  { $eq: ['$target_id', '$$followerId'] },
                  { $eq: ['$status', 'pending'] }
                ]
              }
            }
          }
        ],
        as: 'followRequest'
      }
    },
    {
      $lookup: {
        from: 'profilefollowers',
        let: { followerId: '$followerProfile._id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$follower_id', currentProfile ? currentProfile._id : null] },
                  { $eq: ['$profile_id', '$$followerId'] }
                ]
              }
            }
          }
        ],
        as: 'follower'
      }
    },
    { $sort: { _id: -1 } },
    { $limit: 25 },
    {
      $project: {
        _id: 1,
        author: '$followerProfile.author',
        name: '$followerProfile.name',
        picture: '$followerProfile.picture',
        family_name: '$followerProfile.family_name',
        locale: '$followerProfile.locale',
        given_name: '$followerProfile.given_name',
        created_at: 1,
        isFollower: true,
        isFollowing: { $in: ['$followerProfile._id', followingIds] },
        isFollowRequestSent: { $gt: [{ $size: '$followRequest' }, 0] }
      }
    }
  ];

  const followers = await ProfileFollower.aggregate(pipeline);

  if (currentUser && currentUser !== author && currentProfile) {
    for (const user of followers) {
      const isFollowing = await ProfileFollowing.exists({
        profile_id: currentProfile._id,
        following_id: user._id
      });
      user.isFollowingCurrentUser = !!isFollowing;
    }
  }

  const response = {
    status: 'ok',
    result: followers,
    has_more: followers.length === 25,
    last_id: followers.length > 0 ? followers[followers.length - 1]._id : null
  };

  await cacheClient.set(cacheKey, JSON.stringify(response), 'EX', 600);
  return response;
};

/**
 * Get user comments with post and author data
 * @param {string} author - Profile author ID
 * @param {string} cid - Client ID
 * @param {string} query - Search query (optional)
 * @returns {Promise<Object>} Comments data
 */
const getMoreComments = async (author, cid, query = null) => {
  const searchQuery = validateSearchQuery(query);
  const profile = await Profile.findOne({ author , cid}).lean();
  if (!profile) throw new Error('Profile not found');

  const cacheKey = `comments:${cid}:${author}:${searchQuery || 'no-query'}`;
  const cachedComments = await cacheClient.get(cacheKey);
  if (cachedComments) return { status: 'ok', result: JSON.parse(cachedComments) };

  const comments = await Comment.aggregate([
    { $match: { 
      author: profile.author,
      ...(searchQuery ? { text: { $regex: searchQuery, $options: 'i' } } : {})
    }},
    { $sort: { _id: -1 } },
    { $limit: 30 },
    {
      $lookup: {
        from: 'posts',
        localField: 'post',
        foreignField: '_id',
        as: 'referer'
      }
    },
    { $unwind: { path: '$referer', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'profiles',
        let: { authorId: '$author' },
        pipeline: [
          { $match: { $expr: { $eq: ['$author', '$$authorId'] }, cid } },
          { $project: { author: 1, name: 1, picture: 1, family_name: 1, locale: 1, given_name: 1 } }
        ],
        as: 'authorData'
      }
    },
    { $unwind: { path: '$authorData', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 1,
        text: 1,
        created_at: 1,
        madeAt: '$created_at',
        author: {
          author: '$authorData.author',
          name: '$authorData.name',
          picture: '$authorData.picture',
          family_name: '$authorData.family_name',
          locale: '$authorData.locale',
          given_name: '$authorData.given_name'
        },
        referer: {
          $cond: {
            if: { $eq: ['$referer', null] },
            then: null,
            else: {
              _id: '$referer._id',
              title: { $ifNull: ['$referer.title', '$referer.description'] },
              link: '$referer.link',
              description: '$referer.description',
              created_at: '$referer.created_at'
            }
          }
        }
      }
    },
    { $match: { referer: { $ne: null } } }
  ]);

  await cacheClient.set(cacheKey, JSON.stringify(comments), 'EX', 600);
  return { status: 'ok', result: comments };
};

/**
 * Get user likes with post/comment and author data
 * @param {string} author - Profile author ID
 * @param {string} cid - Client ID
 * @param {string} query - Search query (optional)
 * @returns {Promise<Object>} Likes data
 */
const getMoreLikes = async (author, cid, query = null) => {
  const searchQuery = validateSearchQuery(query);
  const profile = await Profile.findOne({ author, cid }).lean();
  if (!profile) throw new Error('Profile not found');

  const cacheKey = `likes:${cid}:${author}:${searchQuery || 'no-query'}`;
  const cachedLikes = await cacheClient.get(cacheKey);
  if (cachedLikes) return { status: 'ok', result: JSON.parse(cachedLikes) };

  const likes = await ProfileLike.aggregate([
    { $match: { profile_id: profile._id } },
    { $sort: { _id: -1 } },
    { $limit: 30 },
    {
      $lookup: {
        from: 'posts',
        let: { fkId: '$fk_id' },
        pipeline: [
          { 
            $match: { 
              $expr: { $eq: ['$_id', '$$fkId'] },
              'deletion.status': 'active',
              ...(searchQuery ? {
                $or: [
                  { title: { $regex: searchQuery, $options: 'i' } },
                  { description: { $regex: searchQuery, $options: 'i' } }
                ]
              } : {})
            }
          },
          { $project: { title: 1, link: 1, description: 1, created_at: 1 } }
        ],
        as: 'entity'
      }
    },
    {
      $lookup: {
        from: 'comments',
        let: { fkId: '$fk_id' },
        pipeline: [
          { 
            $match: { 
              $expr: { $eq: ['$_id', '$$fkId'] },
              ...(searchQuery ? { text: { $regex: searchQuery, $options: 'i' } } : {})
            }
          },
          { $project: { text: 1, author: 1, created_at: 1, post: 1 } },
          {
            $lookup: {
              from: 'posts',
              let: { postId: '$post' },
              pipeline: [
                { $match: { $expr: { $eq: ['$_id', '$$postId'] }, 'deletion.status': 'active' } },
                { $project: { title: 1, link: 1, description: 1, created_at: 1 } }
              ],
              as: 'postData'
            }
          },
          { $unwind: { path: '$postData', preserveNullAndEmptyArrays: true } },
          {
            $lookup: {
              from: 'profiles',
              let: { authorId: '$author' },
              pipeline: [
                { $match: { $expr: { $eq: ['$author', '$$authorId'] }, cid } },
                { $project: { author: 1, name: 1, picture: 1, family_name: 1, locale: 1, given_name: 1 } }
              ],
              as: 'authorData'
            }
          },
          { $unwind: { path: '$authorData', preserveNullAndEmptyArrays: true } },
          {
            $project: {
              text: 1,
              created_at: 1,
              post: 1,
              postData: 1,
              author: {
                author: '$authorData.author',
                name: '$authorData.name',
                picture: '$authorData.picture',
                family_name: '$authorData.family_name',
                locale: '$authorData.locale',
                given_name: '$authorData.given_name'
              }
            }
          }
        ],
        as: 'comment'
      }
    },
    {
      $project: {
        fk_type: 1,
        created_at: 1,
        entity: { $arrayElemAt: ['$entity', 0] },
        comment: { $arrayElemAt: ['$comment', 0] }
      }
    },
    {
      $match: {
        $or: [
          { entity: { $ne: null } },
          { comment: { $ne: null } }
        ]
      }
    }
  ]);

  const result = likes.map(item => ({
    fk_type: item.fk_type,
    ...(item.entity ? { 
      entity: { 
        ...item.entity, 
        madeAt: item.created_at,
        author: {
          author: profile.author,
          name: profile.name,
          picture: profile.picture
        }
      }
    } : {}),
    ...(item.comment ? {
      fk_type: 'comment',
      text: item.comment.text,
      created_at: item.comment.created_at,
      madeAt: item.created_at,
      author: item.comment.author || null,
      referer: item.comment.postData ? { 
        ...item.comment.postData,
        author: {
          author: profile.author,
          name: profile.name,
          picture: profile.picture
        }
      } : null
    } : {})
  })).filter(Boolean);

  await cacheClient.set(cacheKey, JSON.stringify(result), 'EX', 600);
  return { status: 'ok', result };
};

/**
 * Get user bookmarks with post data
 * @param {string} author - Profile author ID
 * @param {string} cid - Client ID
 * @param {string} query - Search query (optional)
 * @returns {Promise<Object>} Bookmarks data
 */
const getMoreBookmarks = async (author, cid, query = null) => {
  const searchQuery = validateSearchQuery(query);
  const profile = await Profile.findOne({ author, cid }).lean();
  if (!profile) throw new Error('Profile not found');

  const cacheKey = `bookmarks:${cid}:${author}:${searchQuery || 'no-query'}`;
  const cachedBookmarks = await cacheClient.get(cacheKey);
  if (cachedBookmarks) return { status: 'ok', result: JSON.parse(cachedBookmarks) };

  const bookmarks = await ProfileBookmark.aggregate([
    { $match: { profile_id: profile._id } },
    {
      $lookup: {
        from: 'posts',
        let: { postId: '$post_id' },
        pipeline: [
          { 
            $match: { 
              $expr: { $eq: ['$_id', '$$postId'] },
              'deletion.status': 'active',
              ...(searchQuery ? {
                $or: [
                  { title: { $regex: searchQuery, $options: 'i' } },
                  { description: { $regex: searchQuery, $options: 'i' } }
                ]
              } : {})
            }
          },
          { $project: { title: 1, link: 1, description: 1, type: 1, created_at: 1, author: 1 } }
        ],
        as: 'post'
      }
    },
    { $unwind: { path: '$post', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'profiles',
        let: { authorId: '$post.author' },
        pipeline: [
          { 
            $match: { 
              $expr: { $eq: ['$author', '$$authorId'] },
              cid: cid
            }
          },
          { $project: { author: 1, name: 1, picture: 1, family_name: 1, locale: 1, given_name: 1 } }
        ],
        as: 'authorData'
      }
    },
    { $unwind: { path: '$authorData', preserveNullAndEmptyArrays: true } },
    { $sort: { _id: -1 } },
    { $limit: 25 },
    {
      $project: {
        _id: 1,
        created_at: 1,
        post: {
          _id: '$post._id',
          title: '$post.title',
          link: '$post.link',
          description: '$post.description',
          type: '$post.type',
          created_at: '$post.created_at',
          author: {
            author: '$authorData.author',
            name: '$authorData.name',
            picture: '$authorData.picture',
            family_name: '$authorData.family_name',
            locale: '$authorData.locale',
            given_name: '$authorData.given_name'
          }
        }
      }
    },
    { $match: { post: { $ne: null } } }
  ]);

  await cacheClient.set(cacheKey, JSON.stringify(bookmarks), 'EX', 600);
  return { status: 'ok', result: bookmarks };
};

/**
 * Get user shares with post data
 * @param {string} author - Profile author ID
 * @param {string} cid - Client ID
 * @param {string} query - Search query (optional)
 * @returns {Promise<Object>} Shares data
 */
const getMoreShares = async (author, cid, query = null) => {
  const searchQuery = validateSearchQuery(query);
  const profile = await Profile.findOne({ author, cid }).lean();
  if (!profile) throw new Error('Profile not found');

  const cacheKey = `shares:${cid}:${author}:${searchQuery || 'no-query'}`;
  const cachedShares = await cacheClient.get(cacheKey);
  if (cachedShares) return { status: 'ok', result: JSON.parse(cachedShares) };

  const shares = await ProfileShare.aggregate([
    { $match: { profile_id: profile._id } },
    {
      $lookup: {
        from: 'posts',
        let: { postId: '$post_id' },
        pipeline: [
          { 
            $match: { 
              $expr: { $eq: ['$_id', '$$postId'] },
              'deletion.status': 'active',
              ...(searchQuery ? {
                $or: [
                  { title: { $regex: searchQuery, $options: 'i' } },
                  { description: { $regex: searchQuery, $options: 'i' } }
                ]
              } : {})
            }
          },
          { 
            $project: { 
              title: 1, 
              link: 1, 
              description: 1, 
              type: 1, 
              created_at: 1, 
              author: 1 
            }
          }
        ],
        as: 'entity'
      }
    },
    { $unwind: '$entity' }, 
    {
      $lookup: {
        from: 'profiles',
        let: { authorId: '$entity.author' },
        pipeline: [
          { 
            $match: { 
              $expr: { $eq: ['$author', '$$authorId'] },
              cid: cid
            }
          },
          { 
            $project: { 
              author: 1, 
              name: 1, 
              picture: 1, 
              family_name: 1, 
              locale: 1, 
              given_name: 1 
            }
          }
        ],
        as: 'authorData'
      }
    },
    { $unwind: { path: '$authorData', preserveNullAndEmptyArrays: true } },
    { $sort: { _id: -1 } },
    { $limit: 25 },
    {
      $project: {
        _id: 1,
        created_at: 1,
        action_id: '$_id', 
        madeAt: '$created_at',
        entity: { 
          _id: '$entity._id',
          title: '$entity.title',
          link: '$entity.link',
          description: '$entity.description',
          type: '$entity.type',
          created_at: '$entity.created_at',
          author: {
            $cond: {
              if: { $ifNull: ['$authorData', false] },
              then: {
                author: '$authorData.author',
                name: '$authorData.name',
                picture: '$authorData.picture',
                family_name: '$authorData.family_name',
                locale: '$authorData.locale',
                given_name: '$authorData.given_name'
              },
              else: null
            }
          }
        }
      }
    }
  ]);

  await cacheClient.set(cacheKey, JSON.stringify(shares), 'EX', 600);
  return { status: 'ok', result: shares };
};

/**
 * Get blocked users with full profile data
 * @param {string} author - Profile author ID
 * @param {string} cid - Client ID
 * @param {string} query - Search query (optional)
 * @returns {Promise<Object>} Blocked users data
 */
const getMoreBlocked = async (author, cid, query = null) => {
  const searchQuery = validateSearchQuery(query);
  const profile = await Profile.findOne({ author, cid }).lean();
  if (!profile) throw new Error('Profile not found');

  const cacheKey = `blocked:${cid}:${author}:${searchQuery || 'no-query'}`;
  const cachedBlocked = await cacheClient.get(cacheKey);
  if (cachedBlocked) return { status: 'ok', result: JSON.parse(cachedBlocked) };

  const pipeline = [
    { $match: { blocker_id: profile._id } },
    {
      $lookup: {
        from: 'profiles',
        localField: 'blocked_id',
        foreignField: '_id',
        as: 'blockedProfile'
      }
    },
    { $unwind: '$blockedProfile' },
    ...(searchQuery ? [{
      $match: {
        $or: [
          { 'blockedProfile.name': { $regex: searchQuery, $options: 'i' } },
          { 'blockedProfile.given_name': { $regex: searchQuery, $options: 'i' } },
          { 'blockedProfile.family_name': { $regex: searchQuery, $options: 'i' } }
        ]
      }
    }] : []),
    { $sort: { _id: -1 } },
    { $limit: 25 },
    {
      $project: {
        _id: 1,
        author: '$blockedProfile.author',
        name: '$blockedProfile.name',
        picture: '$blockedProfile.picture',
        family_name: '$blockedProfile.family_name',
        locale: '$blockedProfile.locale',
        given_name: '$blockedProfile.given_name',
        created_at: 1,
        visibility: { 
          $cond: { 
            if: { $eq: ['$blockedProfile.settings.privacy.showActivity', 'onlyme'] }, 
            then: 'private', 
            else: 'public' 
          } 
        },
        followerApproval: { $ifNull: ['$blockedProfile.settings.privacy.followerApproval', false] }
      }
    }
  ];

  const blocked = await ProfileBlock.aggregate(pipeline);

  const response = {
    status: 'ok',
    result: blocked,
    has_more: blocked.length === 25,
    last_id: blocked.length > 0 ? blocked[blocked.length - 1]._id : null
  };

  await cacheClient.set(cacheKey, JSON.stringify(response), 'EX', 600);
  return response;
};

/**
 * Search for new potential followers excluding profiles the user already follows
 * @param {string} author - Profile author ID
 * @param {string} cid - Client ID
 * @param {string} query - Search query (optional)
 * @returns {Promise<Object>} Potential followers data
 */
const searchNewFollowers = async (author, cid, query = null) => {
  try {
    // Validación del query
    const searchQuery = query ? query.trim() : null;

    // 1. Verificar cache
    const cacheKey = `new-followers:${cid}:${author}:${searchQuery || 'no-query'}`;
    const cachedResults = await cacheClient.get(cacheKey);
    if (cachedResults) {
      return JSON.parse(cachedResults);
    }

    // 2. Obtener perfil actual con cache
    const currentProfile = await getSingleSourceOfTruthProfile(author, cid);
    if (!currentProfile) {
      throw new Error('Perfil no encontrado');
    }

    // 3. Obtener IDs de seguidos (con cache)
    const followingIds = currentProfile.following.map(f => f._id.toString());

    // 4. Construir pipeline optimizado
    const pipeline = [
      { 
        $match: { 
          cid: cid,
          _id: { 
            $ne: currentProfile._id,
            $nin: followingIds
          },
          ...(searchQuery && { 
            $or: [
              { name: { $regex: searchQuery, $options: 'i' } },
              { given_name: { $regex: searchQuery, $options: 'i' } },
              { family_name: { $regex: searchQuery, $options: 'i' } }
            ]
          })
        }
      },
      {
        $lookup: {
          from: 'profilefollowers',
          let: { profileId: '$_id' },
          pipeline: [{
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$follower_id', currentProfile._id] },
                  { $eq: ['$profile_id', '$$profileId'] }
                ]
              }
            }
          }],
          as: 'follower'
        }
      },
      {
        $lookup: {
          from: 'profilefollowrequests',
          let: { profileId: '$_id' },
          pipeline: [{
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$profile_id', currentProfile._id] },
                  { $eq: ['$target_id', '$$profileId'] },
                  { $eq: ['$status', 'pending'] }
                ]
              }
            }
          }],
          as: 'followRequest'
        }
      },
      {
        $project: {
          _id: 1,
          author: 1,
          name: 1,
          picture: 1,
          given_name: 1,
          family_name: 1,
          locale: 1,
          visibility: { 
            $cond: { 
              if: { $eq: ['$settings.privacy.showActivity', 'onlyme'] }, 
              then: 'private', 
              else: 'public' 
            } 
          },
          followerApproval: { $ifNull: ['$settings.privacy.followerApproval', false] },
          isFollowing: { $gt: [{ $size: '$follower' }, 0] },
          isFollowRequestSent: { $gt: [{ $size: '$followRequest' }, 0] }
        }
      },
      { $sort: { _id: -1 } },
      { $limit: 10 }
    ];

    // 5. Ejecutar consulta
    const profiles = await Profile.aggregate(pipeline).allowDiskUse(true);

    // 6. Construir respuesta
    const response = {
      status: 'ok',
      result: profiles,
      has_more: profiles.length === 10,
      last_id: profiles.length > 0 ? profiles[profiles.length - 1]._id : null
    };

    // 7. Cachear resultado
    await cacheClient.set(cacheKey, JSON.stringify(response), 'EX', 300);

    return response;
  } catch (error) {
    console.error('Error en searchNewFollowers:', error);
    return {
      status: 'error',
      message: error.message,
      result: [],
      has_more: false,
      last_id: null
    };
  }
};

/**
 * Blocks a user profile
 * @param {Object} blockerProfile - Profile object of the blocker
 * @param {Object} blockedProfile - Profile object of the blocked user
 * @param {string} cid - Client ID
 * @returns {Promise<boolean>} True if blocked successfully, false if already blocked
 */
const blockMember = async (blockerProfile, blockedProfile, cid) => {
  try {
    const alreadyBlocked = await ProfileBlock.exists({
      blocker_id: blockerProfile._id,
      blocked_id: blockedProfile._id 
    });

    if (alreadyBlocked) {
      return false;
    }

    await new ProfileBlock({
      blocker_id: blockerProfile._id,
      blocked_id: blockedProfile._id,
      blocked_author: blockedProfile.author,
    }).save();

    // Restrict connection between profiles
    const isFollowing = await ProfileFollowing.findOne({ profile_id: blockerProfile._id, following_id: blockedProfile._id });
    if (isFollowing) await isFollowing.deleteOne();

    const isFollower = await ProfileFollower.findOne({ profile_id: blockedProfile._id, follower_id: blockerProfile._id });
    if (isFollower) await isFollower.deleteOne();

    await Promise.all([
      deleteProfileCache(cid, blockerProfile.author),
      deleteProfileCache(cid, blockedProfile.author)
    ]);

    return true;
  } catch (error) {
    console.error('Error in blockMember:', error);
    throw error;
  }
};

/**
 * Unblocks a user profile
 * @param {Object} blockerProfile - Profile object of the blocker
 * @param {Object} blockedProfile - Profile object of the blocked user
 * @param {string} cid - Client ID
 * @returns {Promise<boolean>} True if unblocked successfully, false if not blocked
 */
const unBlockMember = async (blockerProfile, blockedProfile, cid) => {
  try {
    const blockRecord = await ProfileBlock.findOne({
      blocker_id: blockerProfile._id,
      blocked_id: blockedProfile._id 
    });

    if (!blockRecord) {
      return false;
    }

    await blockRecord.deleteOne();

    await Promise.all([
      deleteProfileCache(cid, blockerProfile.author),
      deleteProfileCache(cid, blockedProfile.author)
    ]);

    return true;
  } catch (error) {
    console.error('Error in unBlockMember:', error);
    throw error;
  }
};

/**
 * Retrieves a populated list of blocked users for a profile
 * @param {Object} blockerProfile - Profile object of the blocker
 * @param {string} cid - Client ID
 * @returns {Promise<Array>} List of blocked user profiles
 */
const getBlockedList = async (blockerProfile, cid) => {
  try {
    const blockedUsers = await ProfileBlock.find({ blocker_id: blockerProfile._id })
      .populate({
        path: 'blocked_id',
        select: 'author name picture given_name family_name locale settings.privacy.showActivity settings.privacy.followerApproval',
        match: { cid }
      })
      .lean();

    return blockedUsers
      .filter(block => block.blocked_id)
      .map(block => ({
        _id: block.blocked_id._id,
        author: block.blocked_id.author,
        name: block.blocked_id.name,
        picture: block.blocked_id.picture,
        given_name: block.blocked_id.given_name,
        family_name: block.blocked_id.family_name,
        locale: block.blocked_id.locale,
        visibility: block.blocked_id.settings?.privacy?.showActivity === 'onlyme' ? 'private' : 'public',
        followerApproval: block.blocked_id.settings?.privacy?.followerApproval || false,
        blocked_at: block.created_at
      }));
  } catch (error) {
    console.error('Error in getBlockedList:', error);
    throw error;
  }
};

module.exports = {
  getProfile,
  getMoreFollowing,
  getMoreFollowers,
  getMoreComments,
  getMoreLikes,
  getMoreBookmarks,
  getMoreBlocked,
  getMoreShares,
  deleteProfileCache,
  getSingleSourceOfTruthProfile,
  searchNewFollowers,
  blockMember, 
  unBlockMember,
  getBlockedList
};