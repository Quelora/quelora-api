// app/services/pushService.js
// Notification Queue Service
// Handles web push notification delivery with retries, rate limiting, and subscription management

const { Queue, Worker, MetricsTime } = require('bullmq');
const IORedis = require('ioredis');
const webPush = require('web-push');
const Profile = require('../models/Profile');
const getClientConfig  = require('./clientConfigService');
const { randomUUID } = require('crypto');

const connection = new IORedis(process.env.CACHE_REDIS_URL, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  enableScripts: false,
  enableAutoPipelining: true,
  maxScriptsCaching: 0
});

// Notification queue with exponential backoff retry policy
const notificationQueue = new Queue('notifications', { 
  connection,
  defaultJobOptions: {
    removeOnComplete: process.env.WORKER_REMOVE_COMPLETED_JOBS === 'true',
    removeOnFail: parseInt(process.env.WORKER_REMOVE_FAILED_JOBS) || 1000,
    attempts: parseInt(process.env.WORKER_MAX_RETRIES) || 3,
    backoff: {
      type: 'exponential',
      delay: parseInt(process.env.WORKER_BACKOFF_DELAY_MS) || 1000,
    },
  },
});

// Worker processing logic for notifications
const notificationWorker = new Worker('notifications', async job => {
  const { cid, author, title, body, data } = job.data;

  try {
    const profile = await Profile.findOne({ author, cid });

    if (!profile || !profile.cid || !profile.pushSubscriptions || profile.pushSubscriptions.length === 0) {
      console.warn(`No active subscriptions or missing cid for user ${author} client ${cid}`);
      return;
    }

    const vapidConfig = await getClientConfig.getClientVapidConfig(profile.cid);

    if (!vapidConfig || !vapidConfig.publicKey || !vapidConfig.privateKey || !vapidConfig.email) {
      console.error(`Missing VAPID configuration for cid: ${profile.cid}`);
      return;
    }

    webPush.setVapidDetails(
      `mailto:${vapidConfig.email}`,
      vapidConfig.publicKey,
      vapidConfig.privateKey
    );

    const payload = JSON.stringify({ title, body, ...data });
    const sendPromises = profile.pushSubscriptions.map(async (subscription) => {
      try {
        await webPush.sendNotification(subscription, payload);
      } catch (err) {
        console.error(`Failed to send notification to ${author}: ${err.message}`);

        if ([404, 410, 400].includes(err.statusCode)) {
          await removeSubscription(author, subscription.endpoint, 'invalid or expired subscription');
        } else if (err.statusCode === 429) {
          throw new Error('Rate limited by push service, retrying later');
        }

        throw err;
      }
    });

    await Promise.all(sendPromises);
  } catch (error) {
    console.error(`Notification processing failed for ${author}: ${error.message}`);
    throw error;
  }
}, { 
  connection,
  concurrency: parseInt(process.env.WORKER_CONCURRENCY) || 10,
  metrics: {
    maxDataPoints: MetricsTime.ONE_WEEK
  },
  limiter: {
    max: parseInt(process.env.WORKER_MAX_JOBS_PER_SECOND) || 1000,
    duration: parseInt(process.env.WORKER_RATE_LIMIT_WINDOW_MS) || 1000,
  },
});

/**
 * Removes invalid push subscriptions from user profile
 * @param {string} author - User identifier
 * @param {string} endpoint - Push subscription endpoint
 * @param {string} reason - Removal reason for logging
 */
async function removeSubscription(author, endpoint, reason) {
  try {
    const result = await Profile.updateOne(
      { author },
      { $pull: { pushSubscriptions: { endpoint } } }
    );
    
    if (result.modifiedCount > 0) {
      console.info(`🚫 Subscription removed → Author: ${author} | Reason: ${reason}`);
    }
  } catch (error) {
    console.error(`Failed to clean up subscription for ${author}: ${error.message}`);
  }
}

// Queue monitoring for observability
const monitorQueue = async () => {
  try {
    const counts = await notificationQueue.getJobCounts();
    console.info(`📊 Queue status - ⏳ Waiting: ${counts.waiting}, ⚙️  Active: ${counts.active}, ✅ Completed: ${counts.completed}, ❌ Failed: ${counts.failed}`);
  } catch (error) {
    console.error(`Queue monitoring error: ${error.message}`);
  }
};

if (process.env.WORKER_MONITOR_INTERVAL_MS) {
  setInterval(monitorQueue, parseInt(process.env.WORKER_MONITOR_INTERVAL_MS));
}

module.exports = {
  notificationQueue,
  addPushJob: async (cid, author, title, body, data = {}) => {
    const jobId = `notif:${cid}:${author}:${Date.now()}:${randomUUID()}`;
    return notificationQueue.add('send-notification', { 
      cid,
      author, 
      title, 
      body, 
      data 
    }, {
      jobId
    });
  },
};
