const mongoose = require('mongoose');
const crypto = require('crypto');
const ngeohash = require('ngeohash');
const { cacheService } = require('../services/cacheService');

// Asegurar que los modelos relacionados estén registrados
require('./ProfileBookmark');
require('./ProfileComment');
require('./ProfileFollower');
require('./ProfileFollowing');
require('./ProfileLike');
require('./ProfileShare');

const profileSchema = new mongoose.Schema({
  cid: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
  },
  author: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true,
    unique: true,
    validate: {
      validator: function(v) {
        const nameRegex = /^[a-zA-Z0-9]{3,15}$/;
        return nameRegex.test(v);
      },
      message: props => `${props.value} is not a valid name. Must contain only letters and numbers, and be between 3-15 characters long.`
    }
  },
  given_name: {
    type: String,
    required: true,
  },
  family_name: {
    type: String,
    required: false,
  },  
  email: {
    type: String,
    required: false,
    trim: true,
    lowercase: true,
    validate: {
      validator: function(v) {
        return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: props => `${props.value} is not a valid email`
    }
  },
  picture: {
    type: String,
    required: false,
  },
  background: {
    type: String,
    required: false,
  },
  locale: {
    type: String,
    required: true,
  },
  bookmarksCount: {
    type: Number,
    default: 0,
  },
  commentsCount: {
    type: Number,
    default: 0,
  },
  followersCount: {
    type: Number,
    default: 0,
  },
  followingCount: {
    type: Number,
    default: 0,
  },  
  blockedCount: {
    type: Number,
    default: 0
  },
  likesCount: {
    type: Number,
    default: 0,
  },
  sharesCount: {
    type: Number,
    default: 0,
  },
  pushSubscriptions: [{
    subscriptionId: {
      type: String,
      required: true,
      index: true 
    },
    platform: {
      type: String,
      enum: ['web', 'android', 'ios', 'other'],
      required: true
    },
    permissionGranted: {
      type: Boolean,
      default: true
    },
    endpoint: {
      type: String,
      required: true
    },
    keys: {
      p256dh: {
        type: String,
        required: true
      },
      auth: {
        type: String,
        required: true
      }
    },
    created_at: {
      type: Date,
      default: Date.now
    },
    updated_at: {
      type: Date,
      default: Date.now
    }
  }],
  settings: {
    notifications: {
      web: { type: Boolean, default: true },
      email: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      newFollowers: { type: Boolean, default: true },
      postLikes: { type: Boolean, default: true },
      comments: { type: Boolean, default: true },
      newPost: { type: Boolean, default: true }
    },
    privacy: {
      type: {
        followerApproval: { type: Boolean, default: true },
        showActivity: {
          type: String,
          enum: ['everyone', 'followers', 'onlyme'],
          default: 'everyone'
        }
      },
      default: {}
    },
    interface: {
      defaultLanguage: { type: String, default: 'es' },
      defaultTheme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
      default: {}
    },
    session: {
      type: {
        rememberSession: { type: Boolean, default: true },
      },
      default: {}
    }
  },  
  location: {
    type: {
      type: String,
      enum: ['Point'],
      required: false
    },
    coordinates: {
      type: [Number],
      validate: {
        validator: function(v) {
          return !v || (v.length === 2 && v.every(n => typeof n === 'number'));
        },
        message: props => `${props.value} is not a valid coordinates array`
      }
    },
    countryCode: {
      type: String,
      trim: true,
      maxlength: 2,
      default: null
    },
    regionCode: {
      type: String,
      trim: true,
      maxlength: 5,
      default: null
    },
    city: {
      type: String,
      trim: true,
      maxlength: 50,
      default: null
    },
    lastUpdated: {
      type: Date,
      default: null
    },
    source: {
      type: String,
      enum: ['manual', 'geocoding', 'ip', 'gps', null],
      default: null
    }
  },
  geohash: {
    type: String,
    default: null,
    index: true
  },
  lastActivityViewed: {
    type: Date,
    default: Date.now,
  },
  created_at: {
    type: Date,
    default: Date.now,
  },
  updated_at: {
    type: Date,
    default: Date.now,
  },
});

// Middleware CACHE findOne
profileSchema.pre('findOne', async function (next) {
  const query = this.getQuery();
  const author = query.author || 'unknown';
  const cid = query.cid || 'unknown';
  const queryString = JSON.stringify(query, Object.keys(query).sort());
  const queryHash = crypto.createHash('md5').update(queryString).digest('hex');
  const cacheKey = `profile:${cid}:${author}:findOne:${queryHash}`;
  
  try {
    const cachedProfile = await cacheService.get(cacheKey);
    if (cachedProfile) {
      this._cachedResult = cachedProfile;
      return next();
    }
  } catch (error) {
    console.error('Error retrieving profile from cache:', error);
  }
  next();
});

profileSchema.post('findOne', async function (result, next) {
  if (this._cachedResult) {
    this._doc = this._cachedResult;
    return next();
  }

  if (result) {
    const query = this.getQuery();
    const author = query.author || 'unknown';
    const cid = query.cid || 'unknown';
    const queryString = JSON.stringify(query, Object.keys(query).sort());
    const queryHash = crypto.createHash('md5').update(queryString).digest('hex');
    const cacheKey = `profile:${cid}:${author}:findOne:${queryHash}`;

    try {
      const cacheData = (typeof result.toObject === 'function') ? result.toObject() : result;
      await cacheService.set(cacheKey, cacheData, 300);
    } catch (error) {
      console.error('Error saving profile to cache:', error);
    }
  }
  next();
});

// Middleware to validate settings
profileSchema.pre('save', function(next) {
  if (this.isModified('settings')) {
    const defaultSettings = {
      notifications: {
        web: true,
        email: true,
        push: true,
        types: {
          newFollowers: true,
          postLikes: true,
          comments: true,
          newPost: true
        }
      },
      privacy: {
        followerApproval: true,
        showActivity: 'everyone'
      },
      interface: {
        defaultLanguage: 'en',
        defaultTheme: 'system-theme',
      },
      session: {
        rememberSession: true
      }
    };

    const cleanSettings = (current, defaults) => {
      Object.keys(current).forEach(key => {
        if (!defaults.hasOwnProperty(key)) {
          delete current[key];
        } else if (typeof current[key] === 'object' && !Array.isArray(current[key])) {
          cleanSettings(current[key], defaults[key]);
        } else if (defaults[key]?.enum && !defaults[key].enum.includes(current[key])) {
          current[key] = defaults[key].default;
        }
      });
    };

    cleanSettings(this.settings, defaultSettings);
    this.settings = { ...defaultSettings, ...this.settings };
  }
  next();
});

// Middleware to create Geohash
profileSchema.pre('save', function (next) {
  if (this.isModified('location')) {
    if (
      this.location?.type === 'Point' &&
      Array.isArray(this.location.coordinates) &&
      this.location.coordinates.length === 2
    ) {
      const [lon, lat] = this.location.coordinates;
      if (typeof lon === 'number' && typeof lat === 'number') {
        this.geohash = ngeohash.encode(lat, lon, 6);
      } else {
        this.geohash = null;
        this.location = null;
      }
    } else {
      this.geohash = null;
      this.location = null;
    }
  }
  next();
});

/**
 * Updates a profile's settings with a specified key-value pair
 * @static
 * @async
 * @param {string} cid - The profile's unique CID
 * @param {string} author - The profile author identifier
 * @param {string} key - The settings key to update (e.g., 'notifications.web')
 * @param {boolean|string} value - The value to set for the specified key
 * @returns {Promise<Object>} The updated profile document
 * @throws {Error} If the key is invalid, value is invalid, or profile not found
 */
profileSchema.statics.updateSettings = async function(cid, author, key, value) {
  const validPaths = {
    'notifications.web': 'boolean',
    'notifications.email': 'boolean',
    'notifications.push': 'boolean',
    'notifications.newFollowers': 'boolean',
    'notifications.postLikes': 'boolean',
    'notifications.comments': 'boolean',
    'notifications.newPost': 'boolean',
    'privacy.followerApproval': 'boolean',
    'privacy.showActivity': 'string',
    'interface.defaultLanguage': 'string',
    'interface.defaultTheme': 'string',
    'session.rememberSession': 'boolean',
  };

  if (!validPaths.hasOwnProperty(key)) {
    throw new Error(`Invalid settings key: ${key}`);
  }

  let processedValue;
  const expectedType = validPaths[key];

  const toBoolean = (val) => {
    if (val === false || val === 'false' || val === 0 || val === '0') return false;
    return true;
  };

  if (expectedType === 'boolean') {
    processedValue = toBoolean(value);
  } else if (expectedType === 'string') {
    if (key === 'content.defaultPostLanguage') {
      const lang = String(value).toLowerCase();
      if (!/^[a-z]{2}$/.test(lang)) {
        throw new Error('Invalid language code');
      }
      processedValue = lang;
    } else if (key === 'privacy.showActivity') {
      if (!['everyone', 'followers', 'onlyme'].includes(value)) {
        throw new Error('Invalid showActivity value');
      }
      processedValue = value;
    } else {
      processedValue = String(value);
    }
  }

  const updatedProfile = await this.findOneAndUpdate(
    { author, cid },
    { 
      $set: { [`settings.${key}`]: processedValue },
      $currentDate: { updated_at: true } 
    },
    { new: true, runValidators: true }
  ).lean();

  if (!updatedProfile) {
    throw new Error('Profile not found');
  }

  const cacheKey = `profile:${author}`;
  await cacheService.delete(cacheKey);
  return updatedProfile;
};


/**
 * Generates a unique profile name based on email or given_name and family_name
 * @private
 * @async
 * @param {string} email - User's email
 * @param {string} name - Combined given_name and family_name
 * @param {string} cid - The profile's unique CID
 * @returns {Promise<string>} A unique profile name
 */
async function generateUniqueName(email, name, cid) {
  const sanitize = (str) => {
    if (!str) return '';
    return str
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 15);
  };

  let baseName;
  let counter = 0;

  if (email) {
    // Extraer el usuario del email (antes del @)
    baseName = sanitize(email.split('@')[0]);
    if (baseName.length < 8) {
      baseName = baseName.padEnd(8, '0');
    }
  } else {
    // Combinar given_name y family_name
    baseName = sanitize(name);
    if (baseName.length < 8) {
      baseName = baseName.padEnd(8, '0');
    }
  }

  let username = baseName.slice(0, 15);
  const nameRegex = /^[a-zA-Z0-9]{3,15}$/;

  if (!nameRegex.test(username)) {
    username = 'user' + Math.floor(1000 + Math.random() * 9000);
  }

  // Verificar unicidad para la tupla name, cid
  while (await this.findOne({ name: username, cid })) {
    counter++;
    username = `${baseName.slice(0, 15 - counter.toString().length)}${counter}`;
    if (!nameRegex.test(username)) {
      username = 'user' + Math.floor(1000 + Math.random() * 9000);
    }
  }

  return username;
}


/**
 * Ensures a profile exists for a user, creating or updating as needed
 * @static
 * @async
 * @param {Object} user - The user object containing profile details
 * @param {string} user.author - The unique author identifier
 * @param {string} user.given_name - The user's given name
 * @param {string} user.family_name - The user's family name
 * @param {string} user.picture - The user's profile picture URL
 * @param {string} user.locale - The user's locale
 * @param {string} cid - The profile's unique CID
 * @returns {Promise<Object>} The created or updated profile document
 */

profileSchema.statics.ensureProfileExists = async function (user, cid, geoData = null) {
  let profile = await this.findOne({ author: user.author, cid: cid });

  if (!profile) {
    const fullName = `${user?.given_name}${user?.family_name || ''}`.trim();
    const uniqueName = await generateUniqueName.call(this, user?.email, fullName, cid);
    profile = new this({
      cid: cid,
      author: user.author,
      name: uniqueName,
      given_name: user.given_name,
      family_name: user.family_name,
      email: user.email,
      picture: user.picture,
      locale: user.locale,
      location: null
    });
  } else {
    const isBase64 = /^data:image\/[a-z]+;base64,/.test(profile.picture);
    const isFromBaseUrl = profile.picture?.startsWith(process.env.BASE_URL);
    
    if (!isBase64 && !isFromBaseUrl && profile.picture !== user.picture) {
      profile.picture = user.picture;
      profile.updated_at = Date.now();
    }
  }

  await profile.save();
  if (geoData && geoData.lon && geoData.lat) {
    await this.updateProfileLocation(profile.cid, profile.author, geoData);
  }

  return profile;
};

/**
 * Retrieves additional likes for a profile with pagination
 * @static
 * @async
 * @param {string} profile_id - The profile's unique identifier
 * @param {string} [lastId] - The ID of the last like for pagination
 * @returns {Promise<Array>} Array of like documents with populated post/comment data
 * @throws {Error} If the lastId is provided but not found
 */
profileSchema.statics.getMoreLikes = async function (profile_id, lastId) {
  const query = { profile_id };
  if (lastId) {
    const lastLike = await mongoose.model('ProfileLike').findById(lastId);
    if (!lastLike) throw new Error('Like no encontrado');
    query.created_at = { $lt: lastLike.created_at };
  }
  return await mongoose.model('ProfileLike').find(query)
    .populate({
      path: 'post_id comment_id',
      select: 'title link description type text author created_at post',
      options: { strictPopulate: false },
    })
    .sort({ created_at: -1 })
    .limit(50);
};

/**
 * Retrieves additional comments for a profile with pagination
 * @static
 * @async
 * @param {string} profile_id - The profile's unique identifier
 * @param {string} [lastId] - The ID of the last comment for pagination
 * @returns {Promise<Array>} Array of comment documents with populated post data
 * @throws {Error} If the lastId is provided but not found
 */
profileSchema.statics.getMoreComments = async function (profile_id, lastId) {
  const query = { profile_id };
  if (lastId) {
    const lastComment = await mongoose.model('ProfileComment').findById(lastId);
    if (!lastComment) throw new Error('Comentario no encontrado');
    query.created_at = { $lt: lastComment.created_at };
  }
  return await mongoose.model('ProfileComment').find(query)
    .populate({
      path: 'post_id',
      select: 'title link description type',
      options: { strictPopulate: false },
    })
    .sort({ created_at: -1 })
    .limit(50);
};

/**
 * Retrieves additional shares for a profile with pagination
 * @static
 * @async
 * @param {string} profile_id - The profile's unique identifier
 * @param {string} [lastId] - The ID of the last share for pagination
 * @returns {Promise<Array>} Array of share documents with populated post data
 * @throws {Error} If the lastId is provided but not found
 */
profileSchema.statics.getMoreShares = async function (profile_id, lastId) {
  const query = { profile_id };
  if (lastId) {
    const lastShare = await mongoose.model('ProfileShare').findById(lastId);
    if (!lastShare) throw new Error('Share no encontrado');
    query.created_at = { $lt: lastShare.created_at };
  }
  return await mongoose.model('ProfileShare').find(query)
    .populate({
      path: 'post_id',
      select: 'title link description type',
      options: { strictPopulate: false },
    })
    .sort({ created_at: -1 })
    .limit(50);
};

/**
 * Retrieves additional bookmarks for a profile with pagination
 * @static
 * @async
 * @param {string} profile_id - The profile's unique identifier
 * @param {string} [lastId] - The ID of the last bookmark for pagination
 * @returns {Promise<Array>} Array of bookmark documents with populated post data
 * @throws {Error} If the lastId is provided but not found
 */
profileSchema.statics.getMoreBookmarks = async function (profile_id, lastId) {
  const query = { profile_id };
  if (lastId) {
    const lastBookmark = await mongoose.model('ProfileBookmark').findById(lastId);
    if (!lastBookmark) throw new Error('Bookmark no encontrado');
    query.created_at = { $lt: lastBookmark.created_at };
  }
  return await mongoose.model('ProfileBookmark').find(query)
    .populate({
      path: 'post_id',
      select: 'title link description type',
      options: { strictPopulate: false },
    })
    .sort({ created_at: -1 })
    .limit(50);
};

/**
 * Retrieves additional followers for a profile with pagination
 * @static
 * @async
 * @param {string} profile_id - The profile's unique identifier
 * @param {string} [lastId] - The ID of the last follower for pagination
 * @returns {Promise<Array>} Array of follower documents with populated follower data
 * @throws {Error} If the lastId is provided but not found
 */
profileSchema.statics.getMoreFollowers = async function (profile_id, lastId) {
  const query = { profile_id };
  if (lastId) {
    const lastFollower = await mongoose.model('ProfileFollower').findById(lastId);
    if (!lastFollower) throw new Error('Seguidor no encontrado');
    query.created_at = { $lt: lastFollower.created_at };
  }
  return await mongoose.model('ProfileFollower').find(query)
    .populate({
      path: 'follower_id',
      select: 'author name picture family_name locale given_name',
      options: { strictPopulate: false },
    })
    .sort({ created_at: -1 })
    .limit(50);
};

/**
 * Retrieves additional following for a profile with pagination
 * @static
 * @async
 * @param {string} profile_id - The profile's unique identifier
 * @param {string} [lastId] - The ID of the last following for pagination
 * @returns {Promise<Array>} Array of following documents with populated following data
 * @throws {Error} If the lastId is provided but not found
 */
profileSchema.statics.getMoreFollowing = async function (profile_id, lastId) {
  const query = { profile_id };
  if (lastId) {
    const lastFollowing = await mongoose.model('ProfileFollowing').findById(lastId);
    if (!lastFollowing) throw new Error('Seguido no encontrado');
    query.created_at = { $lt: lastFollowing.created_at };
  }
  return await mongoose.model('ProfileFollowing').find(query)
    .populate({
      path: 'following_id',
      select: 'author name picture family_name locale given_name',
      options: { strictPopulate: false },
    })
    .sort({ created_at: -1 })
    .limit(50);
};

/**
 * Updates a profile's location information with geodata
 * @static
 * @async
 * @param {string} cid - The profile's unique CID
 * @param {string} author - The profile author identifier
 * @param {Object} geoData - Geodata object containing location details
 * @param {string} [geoData.lon] - Longitude as a string or number
 * @param {string} [geoData.lat] - Latitude as a string or number
 * @param {string} [geoData.countryCode] - 2-letter country code (ISO 3166-1 alpha-2)
 * @param {string} [geoData.regionCode] - Region code (max 5 chars, e.g., 'US-CA')
 * @param {string} [geoData.city] - City name (max 50 chars)
 * @param {'manual'|'geocoding'|'ip'|'gps'} [geoData.source] - Location source
 * @returns {Promise<Object>} The updated profile document
 * @throws {Error} If validation fails or profile not found
 */
profileSchema.statics.updateProfileLocation = async function(cid, author, geoData = {}) {
  try {
    if (!geoData.lat || !geoData.lon) {
      return null; // No location data provided
    }
    
    const lat = parseFloat(geoData.lat);
    const lon = parseFloat(geoData.lon);
    
    if (isNaN(lat) || isNaN(lon)) {
      throw new Error('Coordinates must be valid numbers');
    }

    const location = {
      type: 'Point',
      coordinates: [lon, lat],
      countryCode: geoData.countryCode ? String(geoData.countryCode).trim().toUpperCase().slice(0, 2) : undefined,
      regionCode: geoData.regionCode ? String(geoData.regionCode).trim().toUpperCase().slice(0, 5) : undefined,
      city: geoData.city ? String(geoData.city).trim().slice(0, 50) : undefined,
      lastUpdated: new Date(),
      source: geoData.source && ['manual', 'geocoding', 'ip', 'gps'].includes(geoData.source) ? geoData.source : undefined
    };

    Object.keys(location).forEach(key => {
      if (location[key] === undefined) delete location[key];
    });

    const geohash = ngeohash.encode(lat, lon, 6);

    const updateObj = {
      updated_at: new Date(),
      location,
      geohash
    };

    const updatedProfile = await this.findOneAndUpdate(
      { cid, author },
      { $set: updateObj },
      { new: true, runValidators: true, lean: true }
    );

    if (!updatedProfile) {
      throw new Error('Profile not found');
    }
    return updatedProfile;
  } catch (error) {
    console.error('[Profile Model] Error updating location:', error.message);
    throw error;
  }
};

profileSchema.index({ location: '2dsphere' });
profileSchema.index({ created_at: -1 });
profileSchema.index({ cid: 1 });
profileSchema.index({ cid: 1, _id: 1 });
profileSchema.index({ name: "text" });
profileSchema.index({ name: 1, given_name: 1,family_name: 1 });
profileSchema.index({ author: 1, cid: 1 }, { unique: true });

module.exports = mongoose.model('Profile', profileSchema);