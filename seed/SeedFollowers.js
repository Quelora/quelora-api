// SeedFollowers.js
//
//PROFILE_ID=689cb2d47c0186423bef678e NUM_FOLLOWERS=204 NUM_FOLLOWINGS=96 node SeedFollowers.js
require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const connectDB = require('../db');
const Profile = require('../models/Profile');
const ProfileFollower = require('../models/ProfileFollower');
const ProfileFollowing = require('../models/ProfileFollowing');

const PROFILE_ID = process.env.PROFILE_ID; // Required
const NUM_FOLLOWERS = parseInt(process.env.NUM_FOLLOWERS || 100);
const NUM_FOLLOWINGS = parseInt(process.env.NUM_FOLLOWINGS || 10);

/**
 * Updates profile counters based on current relationships
 */
async function updateProfileCounters(profileId) {
  const followersCount = await ProfileFollower.countDocuments({ profile_id: profileId });
  const followingCount = await ProfileFollowing.countDocuments({ profile_id: profileId });

  await Profile.findByIdAndUpdate(profileId, {
    $set: {
      followersCount,
      followingCount,
      updated_at: new Date()
    }
  });
}

/**
 * Main function to seed followers and followings
 */
async function seedFollowers() {
  if (!PROFILE_ID) {
    console.error('❌ PROFILE_ID is required.');
    process.exit(1);
  }

  try {
    // Connect to the database
    await connectDB();

    // Check if profile exists
    const profile = await Profile.findById(PROFILE_ID);
    if (!profile) {
      console.error('❌ Profile not found.');
      process.exit(1);
    }

    // Delete existing FakeUser relationships
    console.log('⏳ Deleting existing FakeUser relationships...');
    const fakeUserIds = await Profile.find({ name: { $regex: /^FakeUser/ } }).distinct('_id');
    await ProfileFollower.deleteMany({
      $or: [
        { profile_id: PROFILE_ID, follower_id: { $in: fakeUserIds } },
        { profile_id: { $in: fakeUserIds }, follower_id: PROFILE_ID }
      ]
    });
    await ProfileFollowing.deleteMany({
      $or: [
        { profile_id: PROFILE_ID, following_id: { $in: fakeUserIds } },
        { profile_id: { $in: fakeUserIds }, following_id: PROFILE_ID }
      ]
    });
    console.log('✅ Deleted FakeUser relationships.');

    // Fetch all other profiles (excluding target profile and non-FakeUser profiles)
    const otherProfiles = await Profile.find({
      _id: { $ne: PROFILE_ID },
      name: { $regex: /^FakeUser/ }
    });
    const totalOthers = otherProfiles.length;

    const maxNeeded = Math.max(NUM_FOLLOWERS, NUM_FOLLOWINGS);
    if (totalOthers < maxNeeded) {
      console.error(`❌ Not enough FakeUser profiles available (${totalOthers} < ${maxNeeded}).`);
      process.exit(1);
    }

    // Select random unique followers
    const shuffled = otherProfiles.sort(() => 0.5 - Math.random());
    const selectedFollowers = shuffled.slice(0, NUM_FOLLOWERS);
    const followerDocs = [];
    const reciprocalFollowingDocs = [];

    // Check for existing followers to avoid duplicates
    const existingFollowers = await ProfileFollower.find({ profile_id: PROFILE_ID });
    const existingFollowerIds = new Set(existingFollowers.map(e => e.follower_id.toString()));

    for (const f of selectedFollowers) {
      if (!existingFollowerIds.has(f._id.toString())) {
        followerDocs.push({
          profile_id: PROFILE_ID,
          follower_id: f._id,
          created_at: new Date()
        });
        // Create reciprocal following record for the follower
        reciprocalFollowingDocs.push({
          profile_id: f._id,
          following_id: PROFILE_ID,
          created_at: new Date()
        });
      }
    }

    if (followerDocs.length > 0) {
      await ProfileFollower.insertMany(followerDocs);
      await ProfileFollowing.insertMany(reciprocalFollowingDocs);
      console.log(`✅ Added ${followerDocs.length} new followers and their reciprocal followings.`);
    } else {
      console.log('ℹ️ All selected followers already exist.');
    }

    // Select random unique followings
    const selectedFollowings = shuffled.slice(NUM_FOLLOWERS, NUM_FOLLOWERS + NUM_FOLLOWINGS); // Avoid overlap
    const followingDocs = [];
    const reciprocalFollowerDocs = [];

    // Check for existing followings to avoid duplicates
    const existingFollowings = await ProfileFollowing.find({ profile_id: PROFILE_ID });
    const existingFollowingIds = new Set(existingFollowings.map(e => e.following_id.toString()));

    for (const f of selectedFollowings) {
      if (!existingFollowingIds.has(f._id.toString())) {
        followingDocs.push({
          profile_id: PROFILE_ID,
          following_id: f._id,
          created_at: new Date()
        });
        // Create reciprocal follower record for the followed profile
        reciprocalFollowerDocs.push({
          profile_id: f._id,
          follower_id: PROFILE_ID,
          created_at: new Date()
        });
      }
    }

    if (followingDocs.length > 0) {
      await ProfileFollowing.insertMany(followingDocs);
      await ProfileFollower.insertMany(reciprocalFollowerDocs);
      console.log(`✅ Added ${followingDocs.length} new followings and their reciprocal followers.`);
    } else {
      console.log('ℹ️ All selected followings already exist.');
    }

    // Update profile counters for main profile and all affected FakeUser profiles
    console.log('⏳ Updating profile counters...');
    await updateProfileCounters(PROFILE_ID);
    for (const f of selectedFollowers) {
      await updateProfileCounters(f._id);
    }
    for (const f of selectedFollowings) {
      await updateProfileCounters(f._id);
    }
    console.log('✅ Profile counters updated.');

  } catch (err) {
    console.error('❌ Error seeding followers/followings:', err.message);
  } finally {
    // Close the database connection
    await mongoose.connection.close();
    process.exit(0);
  }
}

// Run the script
seedFollowers();