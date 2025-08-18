// SeedFollowers.js
//
//PROFILE_ID=689cb2d47c0186423bef678e NUM_FOLLOWERS=550 NUM_FOLLOWINGS=80 node SeedFollowers.js
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
    const followerDocs = selectedFollowers.map(f => ({
      profile_id: PROFILE_ID,
      follower_id: f._id,
      created_at: new Date()
    }));

    // Check for existing to avoid duplicates
    const existingFollowers = await ProfileFollower.find({ profile_id: PROFILE_ID });
    const existingFollowerIds = new Set(existingFollowers.map(e => e.follower_id.toString()));
    const newFollowers = followerDocs.filter(d => !existingFollowerIds.has(d.follower_id.toString()));

    if (newFollowers.length > 0) {
      await ProfileFollower.insertMany(newFollowers);
      console.log(`✅ Added ${newFollowers.length} new followers.`);
    } else {
      console.log('ℹ️ All selected followers already exist.');
    }

    // Select random unique followings
    const selectedFollowings = shuffled.slice(NUM_FOLLOWERS, NUM_FOLLOWERS + NUM_FOLLOWINGS); // Avoid overlap if possible
    const followingDocs = selectedFollowings.map(f => ({
      profile_id: PROFILE_ID,
      following_id: f._id,
      created_at: new Date()
    }));

    // Check for existing to avoid duplicates
    const existingFollowings = await ProfileFollowing.find({ profile_id: PROFILE_ID });
    const existingFollowingIds = new Set(existingFollowings.map(e => e.following_id.toString()));
    const newFollowings = followingDocs.filter(d => !existingFollowingIds.has(d.following_id.toString()));

    if (newFollowings.length > 0) {
      await ProfileFollowing.insertMany(newFollowings);
      console.log(`✅ Added ${newFollowings.length} new followings.`);
    } else {
      console.log('ℹ️ All selected followings already exist.');
    }

    // Update profile counters
    console.log('⏳ Updating profile counters...');
    await updateProfileCounters(PROFILE_ID);
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