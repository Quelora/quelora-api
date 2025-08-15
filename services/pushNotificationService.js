const { notificationQueue } = require('./pushService');
const Profile = require('../models/Profile');
const ProfileFollower = require('../models/ProfileFollower');
const { getLocalizedMessage } = require('../services/i18nService');

const { randomUUID } = require('crypto');

/**
 * Sends a push notification to a user's followers
 * @param {string} author - User identifier whose followers will be notified
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {Object} data - Additional data (must be a plain object)
 * @param {string} type - Notification type (e.g., 'follow', 'like')
 * @returns {Promise<void>}
 */
async function sendPushNotificationsToFollowers(cid, author, title, message, data = {}, extra = {}, type = 'default') {
  if (!cid || !author || !title || !message) {
    throw new Error('Author, title, and message are required');
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('Data must be a plain object');
  }

  const profile = await Profile.findOne({ author, cid });
  if (!profile) {
    throw new Error(`Profile not found for author ${author} cid ${cid}`);
  }

  const followers = await ProfileFollower.find({ profile_id: profile._id }).populate('follower_id');
  if (!followers || followers.length === 0) {
    return;
  }

  const notificationPromises = followers.map(async (follower) => {
    const followerProfile = follower.follower_id;
    if (!followerProfile || !followerProfile.pushSubscriptions || followerProfile.pushSubscriptions.length === 0) {
      return;
    }

    title = await getLocalizedMessage(title, followerProfile.locale ?? 'en');
    message = await getLocalizedMessage(message, followerProfile.locale ?? 'en', data);

    try {
      await notificationQueue.add('send-notification', {
        cid,
        author: followerProfile.author,
        title,
        body: message,
        data: { type, ...extra }
      }, {
        jobId: `notif:${followerProfile.author}:${Date.now()}:${randomUUID()}`
      });
    } catch (error) {
      console.error(`Failed to queue notification for follower ${followerProfile.author}: ${error.message}`);
    }
  });

  await Promise.all(notificationPromises);
}

/**
 * Sends a push notification to a user
 * @param {string} cid - Client ID
 * @param {string} author - User identifier
 * @param {string} title - Notification title
 * @param {string} message - Notification message
 * @param {Object} data - Additional data (must be a plain object)
 * @param {string} type - Notification type (e.g., 'follow', 'like')
 * @returns {Promise<void>}
 */
async function sendPushNotification(cid, author, title, message, data = {}, extra = {}, type = 'default') {
  if (!cid || !author || !title || !message) {
    throw new Error('Author, title, and message are required');
  }
  
  const profile = await Profile.findOne({ author, cid });

  title = await getLocalizedMessage(title, profile.locale ?? 'en');
  message = await getLocalizedMessage(message, profile.locale ?? 'en', data);

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('Data must be a plain object');
  }


  if (!profile || !profile.pushSubscriptions || profile.pushSubscriptions.length === 0) {
    console.warn(`No active subscriptions for user ${author} - cid ${cid}`);
    return;
  }

  try {
    await notificationQueue.add('send-notification', {
      cid,
      author,
      title,
      body: message,
      data: { type, ...extra }
    }, {
      jobId: `notif:${author}:${Date.now()}:${randomUUID()}`
    });
  } catch (error) {
    console.error(`Failed to queue notification for ${author}: ${error.message}`);
    throw error;
  }
}

module.exports = { sendPushNotification, sendPushNotificationsToFollowers };