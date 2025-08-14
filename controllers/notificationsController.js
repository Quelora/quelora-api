const Profile = require('../models/Profile');
const webPush = require('web-push');
const { addPushJob } = require('../services/pushService');
const { sendMail } = require('../services/emailService');
const profileService = require('../services/profileService');

exports.sendMail = async (req, res) => {
  try {
    const { cid, email, title: subject, body } = req.body;
    const author  = req.user.author;

    // Validación básica de los campos requeridos
    if (!cid || !email || !subject || !body) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: cid, email, title or body'
      });
    }

    // Enviar el correo electrónico
    const mailInfo = await sendMail(cid, author, subject, body, email);

    // Respuesta exitosa
    return res.status(200).json({
      success: true,
      message: 'Email sent successfully',
      data: {
        messageId: mailInfo.messageId,
        accepted: mailInfo.accepted,
        rejected: mailInfo.rejected
      }
    });

  } catch (error) {
    console.error('Error sending email:', error.message);
    
    // Manejo de diferentes tipos de errores
    let statusCode = 500;
    let errorMessage = 'Failed to send email';

    if (error.message.includes('No email configuration found')) {
      statusCode = 404;
      errorMessage = 'Email configuration not found for this client';
    } else if (error.message.includes('No email found for user')) {
      statusCode = 404;
      errorMessage = 'Recipient email not found';
    } else if (error.message.includes('Invalid email')) {
      statusCode = 400;
      errorMessage = 'Invalid email address';
    }

    return res.status(statusCode).json({
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.subscribeProfile = async (req, res) => {
  try {
    const { subscriptionId, platform, permissionGranted, endpoint, keys } = req.body;
    const author = req.user.author;
    const cid = req.cid;

    if (!subscriptionId || !endpoint || !keys || !keys.p256dh || !keys.auth) {
      return res.status(400).json({ 
        error: 'Incomplete subscription data' 
      });
    }

    const subscriptionData = {
      subscriptionId,
      platform: platform || 'web',
      permissionGranted: permissionGranted !== false,
      endpoint,
      keys: {
        p256dh: keys.p256dh,
        auth: keys.auth
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const profile =  await profileService.getProfile(author, cid, { currentUser: req.user.author,
                                                                    includeSettings: true,
                                                                    includeNotifications: true,
                                                                    payloadUser: req.user
                                                                  });

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const existingSubIndex = profile.pushSubscriptions.findIndex(
      sub => sub.subscriptionId === subscriptionId
    );

    if (existingSubIndex >= 0) {
      await Profile.updateOne(
        { author, cid, 'pushSubscriptions.subscriptionId': subscriptionId },
        { $set: { 'pushSubscriptions.$': subscriptionData } }
      );
    } else {
      await Profile.updateOne(
        { author, cid },
        { $push: { pushSubscriptions: subscriptionData } }
      );
    }

    //await sendPushNotification(cid, author, 'welcome_message.title', 'welcome_message.message', {name: profile.name});

    res.json({ 
      success: true,
      message: existingSubIndex >= 0 ? 'Subscription updated' : 'Subscription created',
      subscriptionId
    });

  } catch (error) {
    console.error('Subscription error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.unsubscribeProfile = async (req, res) => {
  try {
    const { subscriptionId } = req.body;
    const author = req.user.author;
    const cid = req.cid;

    if (!subscriptionId) {
      return res.status(400).json({ error: 'subscriptionId required' });
    }

    const result = await Profile.updateOne(
      { author, cid },
      { $pull: { pushSubscriptions: { subscriptionId } } }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    res.json({ 
      success: true,
      message: 'Unsubscribed successfully'
    });

  } catch (error) {
    console.error('Unsubscribe error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.sendNotification = async (req, res) => {
  try {
    const { cid, author, title, body, data } = req.body;

    if (!author) {
      return res.status(400).json({ error: 'author is required' });
    }

    if (!title || !body) {
      return res.status(400).json({ error: 'title and body are required' });
    }

    const job = await addPushJob(cid, author, title, body, data || {});
    
    res.json({ 
      success: true,
      message: 'Notification queued',
      jobId: job.id
    });

  } catch (error) {
    console.error('Notification error:', error);
    res.status(500).json({ error: 'Failed to queue notification' });
  }
};

exports.searchAuthors = async (req, res) => {
  try {
    const { name } = req.query;

    if (!name || name.trim().length < 2) {
      return res.status(400).json({ error: 'Search term must be at least 2 characters' });
    }

    const regex = new RegExp(name.trim(), 'i');

    const profiles = await Profile.find({
      pushSubscriptions: { $exists: true, $not: { $size: 0 } },
      $or: [
        { name: regex },
        { given_name: regex },
        { family_name: regex }
      ]
    })
    .sort({ name: 1 })
    .limit(20)
    .select('author name picture');

    res.json(profiles);
  } catch (error) {
    console.error('searchAuthors error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

exports.validateSubscription = async (req, res) => {
  try {
    const { subscriptionId } = req.body;

    if (!subscriptionId) {
      return res.status(400).json({ 
        error: 'subscriptionId is required' 
      });
    }

    const clientId = req.headers['x-client-id'];
    if (!clientId) {
      return res.status(400).json({ 
        error: 'X-Client-Id header is required' 
      });
    }

    const profile = await Profile.findOne({
      'pushSubscriptions.subscriptionId': subscriptionId
    });

    if (!profile) {
      return res.status(200).json({ 
        active: false
      });
    }

    const subscription = profile.pushSubscriptions.find(
      sub => sub.subscriptionId === subscriptionId
    );

    if (!subscription || subscription.permissionGranted === false) {
      return res.status(200).json({ 
        active: false
      });
    }

    res.status(200).json({  active: true });

  } catch (error) {
    console.error('validateSubscription error:', error);
    res.status(500).json({ 
      error: 'Internal server error'
    });
  }
};

exports.notificationConfig= async (req, res) => {
  res.json({
       status: `ok`,
       code: `
      const { entity, commentId, replyId, follow } = ids;
      switch (type) {
        case 'follower':
          return follow ? \`\${APP_URL}#QUELORA-U-\${follow}\` : APP_URL;
        case 'reply':
          return (entity && commentId && replyId)
            ? \`\${APP_URL}#QUELORA-Q-\${entity}-\${commentId}-\${replyId}\`
            : APP_URL;
        case 'comment':
          return (entity && commentId)
            ? \`\${APP_URL}#QUELORA-Q-\${entity}-\${commentId}\`
            : APP_URL;
        case 'like':
          return (entity && commentId)
            ? (replyId
                ? \`\${APP_URL}#QUELORA-L-\${entity}-\${commentId}-\${replyId}\`
                : \`\${APP_URL}#QUELORA-L-\${entity}-\${commentId}\`)
            : APP_URL;
        default:
          return APP_URL;
      }
    `
  });
}

exports.generateVapidKeys = async (req, res) => {
  try {
    const vapidKeys = webPush.generateVAPIDKeys();
    res.json({
      publicKey: vapidKeys.publicKey,
      privateKey: vapidKeys.privateKey
    });
  } catch (error) {
    console.error('Error generating VAPID keys:', error);
    res.status(500).json({ error: 'Failed to generate VAPID keys' });
  }
};

