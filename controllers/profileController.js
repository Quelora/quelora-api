// ./controllers/profileController.js
const Post = require('../models/Post');
const Activity = require('../models/Activity');
const Profile = require('../models/Profile');
const ProfileBookmark = require('../models/ProfileBookmark');
const ProfileFollower = require('../models/ProfileFollower');
const ProfileFollowing = require('../models/ProfileFollowing');
const ProfileFollowRequest = require('../models/ProfileFollowRequest');

const { sendPushNotification } = require('../services/pushNotificationService');

const activityService = require('../services/activityService');
const profileService = require('../services/profileService');

const fs = require('fs').promises;
const path = require('path');

const validateImage = (base64String, type) => {
  if (!base64String) return null;
  
  try {
    const base64Data = base64String.split(';base64,').pop();
    const buffer = Buffer.from(base64Data, 'base64');
    const sizeInPixels = Math.sqrt(buffer.length / 4);

    if (sizeInPixels > 500) {
      throw new Error(`${type} image exceeds maximum size of 500x500 pixels`);
    }
    
    return buffer;
  } catch (error) {
    console.error(`Error validating ${type}:`, error);
    throw new Error(`Invalid ${type} image or exceeds size limit`);
  }
};

async function saveImageToDisk(base64String, filename) {
  const buffer = validateImage(base64String);
  if (!buffer) return null;
  
  const uploadDir = path.join(__dirname, '../public/assets');
  const filePath = path.join(uploadDir, filename);
  try {
    await fs.mkdir(uploadDir, { recursive: true });
    await fs.writeFile(filePath, buffer);
    return `${process.env.BASE_URL}/assets/${filename}`;
  } catch (error) {
    console.error(`Error saving image ${filename}:`, error);
    throw new Error(`Failed to save ${filename}`);
  }
}

exports.updateProfileSettings = async (req, res, next) => {
    const { key, value } = req.body;
    const { author } = req.user;
    const cid = req.cid;
    try {
        if (!key || value === undefined) {
            throw new Error('Invalid request');
        }
        const profile = await Profile.updateSettings(cid, author, key, value);
        await profileService.deleteProfileCache(cid, author);
        res.status(200).json({ status: 'ok', profile });
    } catch (error) {
    console.error('❌ Error updating profile settings:', error);
    res.status(500).json({ status: 'error', message: 'Internal Server Error.' });
  }
}

exports.updateProfile = async (req, res, next) => {
  const { name, picture, background } = req.body;
  const { author } = req.user;
  const cid = req.cid;

  try {
    const nameRegex = /^[a-zA-Z0-9]{3,15}$/;
    if (!nameRegex.test(name)) {
      return res.status(400).json({
        status: 'ok',
        message: 'The name must contain only common letters, accents, and special characters, and be between 3 and 15 characters long.',
      });
    }
    
    const profile = await Profile.findOne({ author, cid });

    if (!profile) {
      return res.status(404).json({ status: 'ok', message: 'Profile not found.' });
    }

    if (name) profile.name = name;
    
    if (picture) {
      const pictureUrl = await saveImageToDisk(picture, `${author}.webp`);
      if (pictureUrl) profile.picture = pictureUrl;
    }
    if (background) {
      const backgroundUrl = await saveImageToDisk(background, `${author}.background.webp`);
      if (backgroundUrl) profile.background = backgroundUrl;
    }

    profile.updated_at = Date.now();
    await profile.save();
    await profileService.deleteProfileCache(cid, author);

    res.status(200).json({ status: 'ok', message: 'Name updated successfully.', profile });
    
  } catch (error) {
    console.error('❌ Error updating profile:', error);
    res.status(500).json({ status: 'error', message: 'Internal Server Error.' });
  }
};

exports.getMention = async (req, res, next) => {
  try {
    const mention = req.params.mention;
    const author = req.user.author;
    const cid = req.cid;

    const mentionAuthor = await Profile.findOne({ name: mention, cid }).select('author').lean();
    if (!mentionAuthor) {
      return res.status(200).json({ status: 'ok', message: 'Profile not found.' });
    }

    const isSessionUser = (author === mentionAuthor.author);
    const profile = await profileService.getProfile(mentionAuthor.author, cid, {
      currentUser: author,
      includeRelations: true,
      includeCounts: true,
      includeSettings: isSessionUser,
      includeActivity: true,
      includeBookmarks: true,
      geoData: req.geoData || null 
    });

    res.status(200).json({ status: 'ok', profile });
  } catch (error) {
    console.error("❌ Error retrieving profile:", error);
    res.status(500).json({ status: 'error', message: 'Internal server error.' });
  }
};

exports.getProfile = async (req, res, next) => {
  try {
    const cid = req.cid;
    const author = req.params.author || req.user.author;
    if (!author) return res.status(400).json({ status: 'ok', message: 'Author not provided.' });

    const isSessionUser = (author === req.user.author);

    const profile = await profileService.getProfile(author, cid, { currentUser: req.user.author,
                                                                    includeRelations: true,
                                                                    includeCounts: true,
                                                                    includeSettings: isSessionUser,
                                                                    includeActivity:true,
                                                                    includeBookmarks: true,
                                                                    payloadUser: req.user,
                                                                    geoData: req.geoData || null 
                                                                  });

    res.status(200).json({ status: 'ok', profile });
  } catch (error) {
    console.error("❌ Error retrieving profile:", error);
    res.status(500).json({ status: 'error', message: 'Internal server error.' });
  }
};

exports.followUser = async (req, res, next) => {
  const targetId  = req.params.userId;
  const author = req.user.author;
  const cid = req.cid;

  try {
    const currentProfile =  await profileService.getProfile(author, cid, { forceRefresh: true });
    if (currentProfile.author === targetId) { return res.status(403).json({ status: 'ok', message: 'You cannot follow yourself.' }); }

    const profileToFollow =  await profileService.getProfile(targetId, cid, { forceRefresh: true });
    if (!profileToFollow) {  return res.status(404).json({ status: 'ok', message: 'The user to follow does not exist.' }); }

    const isAlreadyFollowing = await ProfileFollowing.exists({ profile_id: currentProfile._id, following_id: profileToFollow._id, });

    if (isAlreadyFollowing) { return res.status(200).json({ status: 'ok', message: 'You are already following this user.' }); }

    //Follower needs to approve
    if (profileToFollow.followerApproval) {
      const existingRequest = await ProfileFollowRequest.findOne({ profile_id: currentProfile._id, target_id: profileToFollow._id, status: 'pending' });
      if (existingRequest) {
        return res.status(200).json({  status: 'ok', message: existingRequest.status === 'pending'  ? 'Follow request already sent' : 'You are already following this user' });
      }
      
      await ProfileFollowRequest.create({ profile_id: currentProfile._id, target_id: profileToFollow._id, status: 'pending', created_at: Date.now() });

      await sendPushNotification( cid,
                                  profileToFollow.author,
                                  'new_follow_request.title',
                                  'new_follow_request.message',
                                  { name: currentProfile.name },
                                  { followRequest: currentProfile.author, icon: currentProfile.picture },
                                  'follow_request');

      await activityService.logActivity({ author: {  _id: currentProfile._id,  username: currentProfile.given_name, picture: currentProfile.picture },
                                          actionType: 'follower-request',
                                          targetProfile: { _id: profileToFollow._id },
                                          references: { profileId: currentProfile._id }});
      
      await profileService.deleteProfileCache(cid, currentProfile.author);
      await profileService.deleteProfileCache(cid, profileToFollow.author);
         
      //Single source of truth
      const updatedProfile =  await profileService.getSingleSourceOfTruthProfile(author, cid);

      return res.status(200).json({ status: 'ok',  message: 'Follow request sent', requiresApproval: true, profile: updatedProfile});
    } else {
      await ProfileFollowing.create({ profile_id: currentProfile._id, following_id: profileToFollow._id, created_at: Date.now() });
      await ProfileFollower.create({ profile_id: profileToFollow._id, follower_id: currentProfile._id, created_at: Date.now() });

      await profileService.deleteProfileCache(cid, currentProfile.author);
      await profileService.deleteProfileCache(cid, profileToFollow.author);

      await sendPushNotification( cid,
                                  profileToFollow.author, 
                                  'new_follower.title', 
                                  'new_follower.message', 
                                  { name: currentProfile.name }, 
                                  { follow: currentProfile.author, icon: currentProfile.picture }, 
                                  'follower' );

      await activityService.logActivity({ author: {  _id: currentProfile._id,  username: currentProfile.given_name, picture: currentProfile.picture },
                                          actionType: 'follower',
                                          targetProfile: { _id: profileToFollow._id },
                                          references: { profileId: currentProfile._id }});


      //Single source of truth
      const updatedProfile =  await profileService.getSingleSourceOfTruthProfile(author, cid);

      return res.status(200).json({  status: 'ok',  message: 'You are now following this user', requiresApproval: false, profile: updatedProfile });
    }
    
  } catch (error) {
    console.error('Error in followUser:', error);
    res.status(500).json({ status: 'error', message: 'Internal server error.' });
  }
};

exports.unfollowUser = async (req, res, next) => {
  const targetId  = req.params.userId;
  const author = req.user.author;
  const cid = req.cid;

  try {
    const currentProfile =  await profileService.getProfile(author, cid, { forceRefresh: true });
    const profileToUnfollow = await profileService.getProfile(targetId, cid, { forceRefresh: true });

    if (!profileToUnfollow) { return res.status(404).json({ status: 'ok', message: 'The user to unfollow does not exist.' }); }

    const isFollowing = await ProfileFollowing.findOne({  profile_id: currentProfile._id, following_id: profileToUnfollow._id });

    if (!isFollowing) { return res.status(200).json({ status: 'ok', message: 'You are not following this user.' }); }
    await isFollowing.deleteOne();

    const isFollower = await ProfileFollower.findOne({ profile_id: profileToUnfollow._id, follower_id: currentProfile._id });
    if(isFollower) { await isFollower.deleteOne(); }

    await profileService.deleteProfileCache(cid, currentProfile.author);
    await profileService.deleteProfileCache(cid, profileToUnfollow.author);

    //Single source of truth
    const updatedProfile =  await profileService.getSingleSourceOfTruthProfile(author, cid);

    res.status(200).json({ status: 'ok', message: 'You have unfollowed this user.', profile: updatedProfile });
    
  } catch (error) {
    console.error('Error unfollowing user:', error);
    res.status(500).json({ status: 'error', message: 'Internal server error.' });
  }
};

exports.approveFollowRequest = async (req, res, next) => {
  const userId = req.params.userId;
  const author = req.user.author;
  const approve = req.body.approve;
  const cid = req.cid;

  try {
    const targetProfile = await profileService.getProfile(author, cid); //target followed
    const requestProfile = await profileService.getProfile(userId, cid); //who requests

    const followRequest = await ProfileFollowRequest.findOne({
      target_id: targetProfile._id,
      profile_id: requestProfile._id,
      status: 'pending'
    }).populate('profile_id', 'author name picture').populate('target_id', 'author name');

    if (!followRequest) {
      return res.status(404).json({ status: 'ok', message: 'Follow request not found or already processed' });
    }

    if (author === userId) {
      return res.status(403).json({ status: 'ok', message: 'You can only approve requests for your own profile' });
    }

    if (approve) {
      await Promise.all([
        ProfileFollowing.create({ profile_id: followRequest.profile_id._id, following_id: targetProfile._id, created_at: Date.now() }),
        ProfileFollower.create({ profile_id: targetProfile._id, follower_id: followRequest.profile_id._id, created_at: Date.now() })
      ]);

      followRequest.status = 'approved';
      followRequest.responded_at = Date.now();
      await followRequest.save();

      await sendPushNotification(
        cid,
        followRequest.profile_id.author,
        'follow_request_approved.title',
        'follow_request_approved.message',
        { name: targetProfile.name },
        { profile: targetProfile.author, icon: targetProfile.picture },
        'follow_approved'
      );

      await activityService.logActivity({
        author: {
          _id: targetProfile._id,
          username: targetProfile.given_name,
          picture: targetProfile.picture
        },
        actionType: 'follow-approval',
        targetProfile: { _id: followRequest.profile_id._id },
        references: { 
          requestId: followRequest._id,
          approvedProfile: targetProfile._id
        }
      });
    } else {
      followRequest.status = 'rejected';
      followRequest.responded_at = Date.now();
      await followRequest.save();
    }

    await profileService.deleteProfileCache(cid, targetProfile._id);
    await profileService.deleteProfileCache(cid, requestProfile._id);

    const updatedProfile = await profileService.getSingleSourceOfTruthProfile(author, cid);

    res.status(200).json({ 
      status: 'ok', 
      message: `Follow request ${approve ? 'approved' : 'rejected' } successfully`, 
      profile: updatedProfile 
    });

  } catch (error) {
    console.error('Error processing follow request:', error);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
};

exports.toggleBookmark = async (req, res, next) => {
  const { entity } = req.params;
  const { author } = req.user;
  const cid = req.cid;

  try {
    const post = await Post.findOne({entity: entity}).lean();;

    if (!post) {
      return res.status(404).json({ status: 'ok', message: 'Post not found.' });
    }

    const profile = await profileService.getProfile(author, cid);

    if (!profile) {
      return res.status(404).json({ status: 'ok', message: 'Profile not found.' });
    }

    const bookmark = await ProfileBookmark.findOne({ profile_id: profile._id, post_id: post._id,});

    let attach;
    if (!bookmark) {
      await ProfileBookmark.create({ profile_id: profile._id, post_id: post._id, created_at: Date.now() });
      attach = true;
    } else {
      await bookmark.deleteOne();
      attach = false;
    }

    await profileService.deleteProfileCache(cid, author);

    //Single source of truth
    const updatedProfile =  await profileService.getSingleSourceOfTruthProfile(author, cid);

    res.status(200).json({ status: 'ok', attach, profile:updatedProfile });
    
  } catch (error) {
    console.error('❌ Error toggling bookmark:', error);
    res.status(500).json({ status: 'error', message: 'Internal server error.' });
  }
};

exports.getFollowingActivities = async (req, res, next) => {
  /**
   * Get activities for profiles followed by the user and 'follow' actions targeting the user's profile,
   * excluding cases where the user follows themselves.
   */
  try {
    // Extract author from request parameters or authenticated user
    const author = req.params.author || req.user.author;
    const { lastActivityTime } = req.query;
    const cid = req.cid;

    // Validate author presence
    if (!author) return res.status(400).json({ status: 'ok', message: 'Author not provided.' });

    const profile = await profileService.getProfile(author, cid);
    if (!profile) return res.status(404).json({ status: 'ok', message: 'Profile not found.' });

    // Get list of followed profile IDs
    const following = await ProfileFollowing.find({ profile_id: profile._id }).select('following_id').lean();
    const followingIds = following.map(f => f.following_id.toString());

    // Query 1: Activities from followed profiles
    let query1 = { 
      target_profile_id: { $in: followingIds },
      action_type: { $ne: 'follow'}
    };

    if (lastActivityTime) query1.created_at = { $gt: new Date(lastActivityTime) };

    // Query 2: 'Follow' activities targeting the user's profile, excluding self-follows
    let query2 = { 
      target_profile_id: profile._id, 
      action_type: 'follow',
      profile_id: { $ne: profile._id } 
    };
    if (lastActivityTime) query2.created_at = { $gt: new Date(lastActivityTime) };

    // Execute both queries in parallel
    const [activitiesFollowing, activitiesFollow] = await Promise.all([
      Activity.find(query1).sort({ created_at: -1 }).limit(50).lean(),
      Activity.find(query2).sort({ created_at: -1 }).limit(50).lean()
    ]);

    // Combine and sort activities by creation date, limit to 50
    const activities = [...activitiesFollowing, ...activitiesFollow]
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, 50);

    // Return empty response if no activities found
    if (!activities.length) return res.status(200).json({ status: 'ok', activities: [], has_more: false });

    // Process activities for response
    const processedActivities = activities.map(activity => ({
      _id: activity._id,
      action_type: activity.action_type,
      author: {
        picture: activity.picture,
        author_username: activity.author_username,
      },
      entity: activity.target,
      created_at: activity.created_at,
      references: activity.references
    }));

    // Build response with processed activities and last activity timestamp
    const response = {
      status: 'ok',
      activities: processedActivities,
      lastActivityTime: processedActivities.length ? processedActivities[processedActivities.length - 1].created_at : null,
    };

    res.status(200).json(response);
    
  } catch (error) {
    console.error('Error getting following activities:', error);
    res.status(500).json({ status: 'error', message: 'Internal server error.' });
  }
};

exports.unifiedSearch = async (req, res, next) => {
  const { author } = req.params;
  const { type, query } = req.query;
  const cid = req.cid;
  const currentUser = req.user?.author;
  const validTypes = ['comments', 'likes', 'shares', 'follower', 'followed', 'bookmarks'];

  try {
    if (!type || !validTypes.includes(type)) {
      return res.status(400).json({ status: 'error', message: `Invalid search type. Valid types are: ${validTypes.join(', ')}`});
    }

    // Check profile privacy
    const profile = await profileService.getProfile(author, cid);
    if (profile?.settings?.privacy?.showActivity === 'onlyme' && currentUser !== author) {
      if (type !== 'follower' && type !== 'followed') {
        return res.status(403).json({ status: 'error', message: 'Activity is private and only available to the profile owner' });
      }
    }

    switch (type) {
      case 'comments': 
        return res.json(await profileService.getMoreComments(author, cid, query));
      case 'likes': 
        return res.json(await profileService.getMoreLikes(author, cid, query));
      case 'shares': 
        return res.json(await profileService.getMoreShares(author, cid, query));
      case 'follower': 
        return res.json(await profileService.getMoreFollowers(author, cid, query, currentUser));
      case 'followed': 
        return res.json(await profileService.getMoreFollowing(author, cid, query, currentUser));
      case 'bookmarks': 
        return res.json(await profileService.getMoreBookmarks(author, cid, query));
      default:
        return res.status(400).json({ status: 'error', message: 'Invalid search type' });
    }
  } catch (error) {
    console.error('Error in unified search:', error);
    res.status(500).json({ status: 'error', message: error.message || 'Internal server error' });
  }
};

exports.searchNewFollowers = async (req, res, next) => {
  const { query } = req.query;
  const cid = req.cid;

  try {
    const response = await profileService.searchNewFollowers(req.user.author, cid, query);
    res.status(200).json(response);
  } catch (error) {
    console.error('Error searching new followers:', error);
    res.status(500).json({ status: 'error', message: 'Internal server error.' });
  }
};