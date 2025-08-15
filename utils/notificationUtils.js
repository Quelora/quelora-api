const { sendPushNotification, sendPushNotificationsToFollowers } = require('../services/pushNotificationService');
const activityService = require('../services/activityService');
const profileService = require('../services/profileService');
const Profile = require('../models/Profile');
const { cacheService } = require('../services/cacheService');

const sendNotificationAndLogActivity = async ({
  req,
  cid,
  entity,
  postId,
  commentId,
  replyId = null,
  actionType,
  notificationType,
  recipient = null,
  targetPreview = null,
  cacheKeys = []
}) => {
  const author = req.user.author;
  const profile = await Profile.findOne({ author, cid }).select('author name given_name family_name picture locale created_at _id');
  if (!profile) {
    throw new Error('Profile not found.');
  }

  // Determinar el idioma objetivo (locale del destinatario o del autor si no hay destinatario)
  let targetLocale = profile.locale?.substring(0, 2) || 'es';
  if (recipient) {
    const recipientProfile = await Profile.findOne({ author: recipient, cid }).select('locale');
    targetLocale = recipientProfile?.locale?.substring(0, 2) || 'es';
  }

  // Traducir el título y el mensaje
  const titleKey = `${notificationType}.title`;
  const messageKey = `${notificationType}.message`;

  const notificationData = {
    name: profile.name,
    ...(targetPreview && { [actionType === 'comment' ? 'post' : 'comment']: targetPreview })
  };

  const references = {
    entity,
    commentId,
    ...(replyId && { replyId }),
    ...(actionType.includes('follow') && { profileId: profile._id })
  };

  if (recipient) {
    await sendPushNotification(
      cid,
      recipient,
      titleKey,
      messageKey,
      notificationData,
      {
        ...references,
        ...(actionType.includes('follow') ? { icon: profile.picture } : {})
      },
      notificationType
    );
  } else {
    await sendPushNotificationsToFollowers(
      cid,
      author,
      titleKey,
      messageKey,
      notificationData,
      {
        ...references,
        ...(actionType.includes('follow') ? { icon: profile.picture } : {})
      },
      notificationType
    );
  }

  await activityService.logActivity({
    author: { _id: profile._id, username: profile.name, picture: profile.picture },
    actionType,
    target: {
      type: actionType === 'comment' ? 'post' : actionType.includes('follow') ? 'profile' : actionType,
      id: postId || profile._id,
      preview: targetPreview?.substring(0, 50) + (targetPreview?.length > 50 ? '...' : '')
    },
    targetProfile: actionType.includes('follow') ? { _id: profile._id } : undefined,
    references
  });

  await profileService.deleteProfileCache(cid, author);
  await Promise.all(cacheKeys.map(key => cacheService.delete(key)));
};

module.exports = { sendNotificationAndLogActivity };