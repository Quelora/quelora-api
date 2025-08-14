const { Queue, Worker, MetricsTime } = require('bullmq');
const IORedis = require('ioredis');
const nodemailer = require('nodemailer');
const Profile = require('../models/Profile');
const { randomUUID } = require('crypto');
const getClientConfig = require('./clientConfigService');

const connection = new IORedis(process.env.CACHE_REDIS_URL, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  enableScripts: false,
  enableAutoPipelining: true,
  maxScriptsCaching: 0
});

// Email queue with exponential backoff retry policy
const emailQueue = new Queue('emails', {
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

// Worker processing logic for emails
const emailWorker = new Worker('emails', async job => {
  const { cid, author, subject, body, to } = job.data;

  try {
    const profile = await Profile.findOne({ author, cid });

    if (!profile || !profile.email) {
      console.warn(`No valid email for user ${author} client ${cid}`);
      return;
    }

    // Get client-specific email config
    const emailConfig = await getClientConfig.getClientEmailConfig(cid);
    if (!emailConfig) {
      throw new Error(`No email configuration found for client ${cid}`);
    }

    // Create transporter with client-specific config
    const clientTransporter = nodemailer.createTransport({
      host: emailConfig.smtp_host,
      port: parseInt(emailConfig.smtp_port) || 587,
      secure: emailConfig.smtp_port === '465',
      auth: {
        user: emailConfig.smtp_user,
        pass: emailConfig.smtp_pass,
      },
    });

    const mailOptions = {
      from: emailConfig.smtp_user,
      to: to || profile.email,
      subject,
      html: body,
    };

    await clientTransporter.sendMail(mailOptions);
  } catch (error) {
    console.error(`Email processing failed for ${author}: ${error.message}`);
    if (error.responseCode === 429) {
      throw new Error('Rate limited by email service, retrying later');
    }
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

// Queue monitoring for observability
const monitorQueue = async () => {
  try {
    const counts = await emailQueue.getJobCounts();
    console.info(`📊 Email Queue status - ⏳ Waiting: ${counts.waiting}, ⚙️ Active: ${counts.active}, ✅ Completed: ${counts.completed}, ❌ Failed: ${counts.failed}`);
  } catch (error) {
    console.error(`Email queue monitoring error: ${error.message}`);
  }
};

if (process.env.WORKER_MONITOR_INTERVAL_MS) {
  setInterval(monitorQueue, parseInt(process.env.WORKER_MONITOR_INTERVAL_MS));
}

// Send mail function with client-specific configuration
const sendMail = async (cid, author, subject, body, to = null) => {
  try {
    // Get client email config
    const emailConfig = await getClientConfig.getClientEmailConfig(cid);
    if (!emailConfig) {
      throw new Error(`No email configuration found for client ${cid}`);
    }

    // Create transporter with client-specific config
    const transporter = nodemailer.createTransport({
      host: emailConfig.smtp_host,
      port: parseInt(emailConfig.smtp_port) || 587,
      secure: emailConfig.smtp_port === '465',
      auth: {
        user: emailConfig.smtp_user,
        pass: emailConfig.smtp_pass,
      },
    });

    // Get recipient email from profile if not provided
    let recipientEmail = to;
    if (!recipientEmail) {
      const profile = await Profile.findOne({ author, cid });
      if (!profile || !profile.email) {
        throw new Error(`No email found for user ${author} in client ${cid}`);
      }
      recipientEmail = profile.email;
    }

    const mailOptions = {
      from: emailConfig.smtp_user,
      to: recipientEmail,
      subject,
      html: body,
    };

    // Send email directly (not through queue)
    const info = await transporter.sendMail(mailOptions);
    return info;
  } catch (error) {
    console.error(`Failed to send email to ${to || author}: ${error.message}`);
    throw error;
  }
};

module.exports = {
  emailQueue,
  addEmailJob: async (cid, author, subject, body, to = null) => {
    const jobId = `email:${cid}:${author}:${Date.now()}:${randomUUID()}`;
    return emailQueue.add('send-email', {
      cid,
      author,
      subject,
      body,
      to
    }, {
      jobId
    });
  },
  sendMail,
};