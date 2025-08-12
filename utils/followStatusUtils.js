// ./app/utils/followStatusUtils.js
const Profile = require('../models/Profile');
const ProfileFollower = require('../models/ProfileFollower');
const ProfileFollowing = require('../models/ProfileFollowing');

const enrichLikesWithFollowStatus = async (likes, userAuthor, cid) => {
  if (!userAuthor) {
    return likes.map(like => ({
      ...like,
      isFollower: false,
      isFollowing: false
    }));
  }

  const profile = await Profile.findOne({ author: userAuthor, cid });
  if (!profile) {
    return likes.map(like => ({
      ...like,
      isFollower: false,
      isFollowing: false
    }));
  }

  const followers = await ProfileFollower.find({ profile_id: profile._id })
    .select('follower_id').lean();
  const followings = await ProfileFollowing.find({ profile_id: profile._id })
    .select('following_id').lean();

  const followerIds = followers.map(f => f.follower_id.toString());
  const followingIds = followings.map(f => f.following_id.toString());

  const profileMap = {};
  const authorIds = [...new Set(likes.map(like => like.author))];
  const profiles = await Profile.find({ author: { $in: authorIds } })
    .select('_id author').lean();
  profiles.forEach(p => {
    profileMap[p.author] = p._id.toString();
  });

  return likes.map(like => ({
    ...like,
    isFollower: profileMap[like.author] ? followerIds.includes(profileMap[like.author]) : false,
    isFollowing: profileMap[like.author] ? followingIds.includes(profileMap[like.author]) : false
  }));
};

module.exports = { enrichLikesWithFollowStatus };