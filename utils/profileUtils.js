// ./utils/profileUtils.js
const { cacheService } = require('../services/cacheService');
const profileService = require('../services/profileService');
const ProfileFollowing =  require('../models/ProfileFollowing');
const Profile = require('../models/Profile');

/**
* Gets the authenticated user's profile ID
* @param {string} author - Author (user) ID
* @param {string} cid - Client/context ID
* @returns {Promise<string|null>} - User's profile ID, or null if it doesn't exist
*/
const getSessionUserId = async (author, cid) => {
  if (!author) return null;

  const cacheKey = `sessionUserId:${cid}:${author}`;
  const cachedUserId = await cacheService.get(cacheKey);

  if (cachedUserId) {
    console.log('⚡ sessionUserId obtained from cache');
    return cachedUserId;
  }

  const sessionProfile = await Profile.findOne({ author, cid }).lean(); 
  const sessionUserId = sessionProfile?._id || null; 

  if (sessionUserId) { 
    await cacheService.set(cacheKey, sessionUserId, 3600); 
  } 

  return sessionUserId;
};


/**
* Gets the user's preferred language from their profile.
* Returns 'en' (English) as the default language if it can't be determined.
* @param {string|null} author - The author ID.
* @param {string} cid - The client/community ID.
* @returns {Promise<string>} The language code (e.g., 'es', 'en').
*/
const getUserLanguage = async (author, cid) => {
    if (!author) return 'en';
    try {
        const userProfile = await profileService.getProfile(author, cid);
        if (userProfile && userProfile.locale) {
            return userProfile.locale.split('-')[0];
        }
    } catch (error) {
        console.error(`Error al obtener el perfil para el autor ${author}:`, error);
    }
    return 'en';
};

/**
 * Retrieves profile information for comment authors, including follow status and visibility settings.
 * Uses caching to optimize performance and reduce database queries.
 *
 * @param {Array} comments - Array of comment objects containing author IDs.
 * @param {string|null} sessionUserId - ID of the current session user (optional, for follow status).
 * @param {string} cid - Context ID for scoping the profile query.
 * @returns {Promise<Object>} A map of author IDs to their profile data, including visibility and follow status.
 */
const getProfilesForComments = async (comments, sessionUserId = null, cid) => {
  const authorIds = comments.map(comment => comment.author);
  const uniqueAuthorIds = [...new Set(authorIds)];
  const cacheKey = `cid:${cid}:profiles:${uniqueAuthorIds.join(':')}`;

  const cachedProfiles = await cacheService.get(cacheKey);
  if (cachedProfiles) {
    console.log('⚡ Perfiles obtenidos desde la caché');
    return cachedProfiles;
  }

  const profiles = await Profile.find({ author: { $in: uniqueAuthorIds }, cid })
    .select('author name given_name family_name picture locale created_at followersCount followingCount commentsCount settings.privacy.showActivity')
    .lean();

  // Obtener isFollowing para cada perfil único
  const profileMap = {};
  if (sessionUserId && profiles.length > 0) {
    const profileIds = profiles.map(profile => profile._id);
    const followStatuses = await Promise.all(
      profileIds.map(async profileId => {
        const isFollowing = await ProfileFollowing.isFollowing(sessionUserId, profileId);
        return { profileId, isFollowing };
      })
    );

    const followStatusMap = {};
    followStatuses.forEach(({ profileId, isFollowing }) => {
      followStatusMap[profileId] = isFollowing;
    });

    profiles.forEach(profile => {
      const { settings, ...profileData } = profile;
      let visibility;
      switch (profile.settings?.privacy?.showActivity) {
        case 'everyone':
          visibility = 'public';
          break;
        case 'followers':
          visibility = 'restricted';
          break;
        case 'onlyme':
          visibility = 'private';
          break;
        default:
          visibility = 'private';
      }
      profileMap[profile.author] = {
        ...profileData,
        visibility,
        isFollowing: followStatusMap[profile._id] || false
      };
    });
  } else {
    profiles.forEach(profile => {
      const { settings, ...profileData } = profile;
      let visibility;
      switch (profile.settings?.privacy?.showActivity) {
        case 'everyone':
          visibility = 'public';
          break;
        case 'followers':
          visibility = 'restricted';
          break;
        case 'onlyme':
          visibility = 'private';
          break;
        default:
          visibility = 'private';
      }
      profileMap[profile.author] = {
        ...profileData,
        visibility,
        isFollowing: false
      };
    });
  }

  await cacheService.set(cacheKey, profileMap, 3600);
  return profileMap;
};


module.exports = { getSessionUserId, getUserLanguage ,getProfilesForComments };
