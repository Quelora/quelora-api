// models/Post.js
const mongoose = require('mongoose');

// Definir el objeto config default con sus tipos esperados
const defaultConfig = {
  "visibility": "public",
  "comment_status": "open",
  "interaction": {
    "allow_comments": true,
    "allow_likes": true,
    "allow_shares": true,
    "allow_replies": true,
    "allow_bookmarks": true,
  },
  "moderation": {
    "enable_toxicity_filter": true,
    "enable_content_moderation": true,
    "moderation_prompt": "",
    "banned_words": []
  },
  "limits": {
    "post_text": 1000,
    "comment_text": 200,
    "reply_text": 200
  },
  "tags": ["deporte", "futbol"],
  "category": "General",
  "publish_schedule": {
    "immediate": true,
    "scheduled_time": "2100-12-31T23:59:59Z"
  },
  "notifications": {
    "notify_followers": false,
    "notify_mentions": false
  },
  "editing": {
    "allow_delete": true,
    "allow_edits": true,
    "edit_time_limit": 5
  },
  "language": {
    "post_language": "es",
    "auto_translate": true
  },
  "expiration": {
    "enable": true,
    "expire_at": "2100-12-31T23:59:59Z"
  },
  "modeDiscovery": false,
  "audio": {
    "enable_mic_transcription": false,
    "save_comment_audio": false,
    "max_recording_seconds": 60,
    "bitrate":16000,
  },
};

// Función para validar el objeto config
function validateConfig(config) {
  // Si el config no existe, usar el default
  if (!config) return defaultConfig;
  
  // Validar cada propiedad del config
  const validConfig = {};
  
  // Validar propiedades top-level
  for (const [key, defaultValue] of Object.entries(defaultConfig)) {
    if (config.hasOwnProperty(key)) {
      // Validar según el tipo de cada propiedad
      switch (key) {
        case 'visibility':
          if (typeof config[key] === 'string' && ['public', 'private', 'followers'].includes(config[key])) {
            validConfig[key] = config[key];
          } else {
            validConfig[key] = defaultValue;
          }
          break;
          
        case 'comment_status':
          if (typeof config[key] === 'string' && ['open', 'closed'].includes(config[key])) {
            validConfig[key] = config[key];
          } else {
            validConfig[key] = defaultValue;
          }
        break;

        case 'interaction':
          if (typeof config[key] === 'object' && config[key] !== null) {
            const validInteraction = {};
            for (const [interactionKey, interactionDefault] of Object.entries(defaultConfig.interaction)) {
              if (config[key].hasOwnProperty(interactionKey) && typeof config[key][interactionKey] === 'boolean') {
                validInteraction[interactionKey] = config[key][interactionKey];
              } else {
                validInteraction[interactionKey] = interactionDefault;
              }
            }
            validConfig[key] = validInteraction;
          } else {
            validConfig[key] = defaultValue;
          }
          break;
          
        case 'moderation':
          if (typeof config[key] === 'object' && config[key] !== null) {
            const validModeration = {};
            for (const [modKey, modDefault] of Object.entries(defaultConfig.moderation)) {
              if (config[key].hasOwnProperty(modKey)) {
                if (modKey === 'banned_words' && Array.isArray(config[key][modKey])) {
                  validModeration[modKey] = config[key][modKey].filter(word => typeof word === 'string' && word.length <= 50);
                } else if (modKey === 'moderation_prompt' && typeof config[key][modKey] === 'string' && config[key][modKey].length <= 200) {
                  validModeration[modKey] = config[key][modKey];
                } else if ((modKey === 'enable_toxicity_filter' || modKey === 'enable_content_moderation') && typeof config[key][modKey] === 'boolean') {
                  validModeration[modKey] = config[key][modKey];
                } else {
                  validModeration[modKey] = modDefault;
                }
              } else {
                validModeration[modKey] = modDefault;
              }
            }
            validConfig[key] = validModeration;
          } else {
            validConfig[key] = defaultValue;
          }
          break;
          
        case 'limits':
          if (typeof config[key] === 'object' && config[key] !== null) {
            const validLimits = {};
            for (const [limitKey, limitDefault] of Object.entries(defaultConfig.limits)) {
              if (config[key].hasOwnProperty(limitKey) && typeof config[key][limitKey] === 'number' && config[key][limitKey] > 0) {
                validLimits[limitKey] = config[key][limitKey];
              } else {
                validLimits[limitKey] = limitDefault;
              }
            }
            validConfig[key] = validLimits;
          } else {
            validConfig[key] = defaultValue;
          }
          break;
          
        case 'tags':
          if (Array.isArray(config[key])) {
            validConfig[key] = config[key]
              .filter(tag => typeof tag === 'string' && tag.length <= 30)
              .slice(0, 10); // Limitar a 10 tags máximo
          } else {
            validConfig[key] = defaultValue;
          }
          break;
          
        case 'category':
          if (typeof config[key] === 'string' && config[key].length <= 50) {
            validConfig[key] = config[key];
          } else {
            validConfig[key] = defaultValue;
          }
          break;
          
        case 'publish_schedule':
          if (typeof config[key] === 'object' && config[key] !== null) {
            const validSchedule = {};
            if (typeof config[key].immediate === 'boolean') {
              validSchedule.immediate = config[key].immediate;
            } else {
              validSchedule.immediate = defaultValue.immediate;
            }
            
            if (typeof config[key].scheduled_time === 'string' && !isNaN(Date.parse(config[key].scheduled_time))) {
              validSchedule.scheduled_time = config[key].scheduled_time;
            } else {
              validSchedule.scheduled_time = defaultValue.scheduled_time;
            }
            validConfig[key] = validSchedule;
          } else {
            validConfig[key] = defaultValue;
          }
          break;
          
        case 'notifications':
          if (typeof config[key] === 'object' && config[key] !== null) {
            const validNotifications = {};
            for (const [notifKey, notifDefault] of Object.entries(defaultConfig.notifications)) {
              if (config[key].hasOwnProperty(notifKey) && typeof config[key][notifKey] === 'boolean') {
                validNotifications[notifKey] = config[key][notifKey];
              } else {
                validNotifications[notifKey] = notifDefault;
              }
            }
            validConfig[key] = validNotifications;
          } else {
            validConfig[key] = defaultValue;
          }
          break;
          
        case 'location':
          if (typeof config[key] === 'object' && config[key] !== null) {
            const validLocation = {};
            if (typeof config[key].enable === 'boolean') {
              validLocation.enable = config[key].enable;
            } else {
              validLocation.enable = defaultValue.enable;
            }
            
            if (typeof config[key].visible === 'boolean') {
              validLocation.visible = config[key].visible;
            } else {
              validLocation.visible = defaultValue.visible;
            }
            
            if (typeof config[key].coordinates === 'object' && config[key].coordinates !== null &&
                typeof config[key].coordinates.lat === 'number' && typeof config[key].coordinates.lng === 'number') {
              validLocation.coordinates = {
                lat: config[key].coordinates.lat,
                lng: config[key].coordinates.lng
              };
            } else {
              validLocation.coordinates = defaultValue.coordinates;
            }
            validConfig[key] = validLocation;
          } else {
            validConfig[key] = defaultValue;
          }
          break;
          
        case 'editing':
          if (typeof config[key] === 'object' && config[key] !== null) {
            const validEditing = {};
            for (const [editKey, editDefault] of Object.entries(defaultConfig.editing)) {
              if (config[key].hasOwnProperty(editKey)) {
                if ((editKey === 'allow_delete' || editKey === 'allow_edits') && typeof config[key][editKey] === 'boolean') {
                  validEditing[editKey] = config[key][editKey];
                } else if (editKey === 'edit_time_limit' && typeof config[key][editKey] === 'number' && config[key][editKey] >= 0) {
                  validEditing[editKey] = config[key][editKey];
                } else {
                  validEditing[editKey] = editDefault;
                }
              } else {
                validEditing[editKey] = editDefault;
              }
            }
            validConfig[key] = validEditing;
          } else {
            validConfig[key] = defaultValue;
          }
          break;

        case 'audio':
          if (typeof config[key] === 'object' && config[key] !== null) {
            const validAudio = {};
            for (const [audioKey, audioDefault] of Object.entries(defaultConfig.audio)) {
              if (config[key].hasOwnProperty(audioKey)) {
                if ((audioKey === 'enable_mic_transcription' || audioKey === 'save_comment_audio') && typeof config[key][audioKey] === 'boolean') {
                  validAudio[audioKey] = config[key][audioKey];
                } else if (audioKey === 'max_recording_seconds' && typeof config[key][audioKey] === 'number' && config[key][audioKey] >= 0) {
                  validAudio[audioKey] = config[key][audioKey];
                } else if (audioKey === 'bitrate' && typeof config[key][audioKey] === 'number' && config[key][audioKey] > 0) {
                  validAudio[audioKey] = config[key][audioKey];
                } else {
                  validAudio[audioKey] = audioDefault;
                }
              } else {
                validAudio[audioKey] = audioDefault;
              }
            }
            validConfig[key] = validAudio;
          } else {
            validConfig[key] = defaultValue;
          }
          break;

        case 'language':
          if (typeof config[key] === 'object' && config[key] !== null) {
            const validLanguage = {};
            if (typeof config[key].post_language === 'string' && config[key].post_language.length <= 10) {
              validLanguage.post_language = config[key].post_language;
            } else {
              validLanguage.post_language = defaultValue.post_language;
            }
            
            if (typeof config[key].auto_translate === 'boolean') {
              validLanguage.auto_translate = config[key].auto_translate;
            } else {
              validLanguage.auto_translate = defaultValue.auto_translate;
            }
            validConfig[key] = validLanguage;
          } else {
            validConfig[key] = defaultValue;
          }
          break;
          
        case 'expiration':
          if (typeof config[key] === 'object' && config[key] !== null) {
            const validExpiration = {};
            if (typeof config[key].enable === 'boolean') {
              validExpiration.enable = config[key].enable;
            } else {
              validExpiration.enable = defaultValue.enable;
            }
            
            if (typeof config[key].expire_at === 'string' && !isNaN(Date.parse(config[key].expire_at))) {
              validExpiration.expire_at = config[key].expire_at;
            } else {
              validExpiration.expire_at = defaultValue.expire_at;
            }
            validConfig[key] = validExpiration;
          } else {
            validConfig[key] = defaultValue;
          }
          break;
       
        case 'modeDiscovery':
          if (typeof config[key] === 'boolean') {
            validConfig[key] = config[key];
          } else {
            validConfig[key] = defaultValue;
          }
          break;

        default:
          validConfig[key] = defaultValue;
      }
    } else {
      validConfig[key] = defaultValue;
    }
  }
  
  return validConfig;
}

const postSchema = new mongoose.Schema({
  cid: { 
    type: String,
    required: true,
  },
  entity: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    unique: true,
  },
  reference: {
    type: String,
    required: false,
    trim: true,
    maxlength: 500
  },
  title: {
    type: String,
    required: false,
    trim: true,
    maxlength: 100
  },
  link: {
    type: String,
    required: false,
    trim: true,
    maxlength: 150
  },
  type: {
    type: String,
    required: false,
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    required: false,
    trim: true
  },
  image: { 
    type: String, 
    default: null 
  },
  config: {
    type: mongoose.Schema.Types.Mixed,
    default: defaultConfig,
    required: true,
  },
  likes: [{ type: String }],
  sharesCount: {
    type: Number,
    default: 0 
  },
  commentCount: {
    type: Number,
    default: 0 
  },
  likesCount: {
    type: Number,
    default: 0 
  }, 
  viewsCount: {
    type: Number,
    default: 0 
  }, 
  moreCommentsRef: {
    type: [String],
    default: []
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  deletion: {
    status: {
      type: String,
      enum: ['active', 'trash', 'purged'],
      default: 'active'
    },
    movedToTrashAt: {
      type: Date,
      default: null
    },
    scheduledPurgeAt: {
      type: Date,
      default: null
    },
    movedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  },
});

postSchema.pre('save', async function (next) {
  try {
    if (!this.config || typeof this.config !== 'object') {
      const clientConfigService  = require('../services/clientConfigService');
      const clientConfig = await clientConfigService.getClientPostConfig(cid);

      if (clientConfig && typeof clientConfig === 'object') {
        this.config = validateConfig(clientConfig);
      } else {
        this.config = defaultConfig;
      }
    } else {
      this.config = validateConfig(this.config);
    }
    next();
  } catch (err) {
    next(err);
  }
});

postSchema.pre('save', function(next) {
  if (this.likes.length > 1000) {
    this.likes = this.likes.slice(-1000);
  }
  next();
});

// Middleware para validar el config antes de actualizar
postSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();
  if (update.$set && update.$set.config) {
    update.$set.config = validateConfig(update.$set.config);
  } else if (update.config) {
    update.config = validateConfig(update.config);
  }
  next();
});

// Métodos estáticos
postSchema.statics.addShare = async function(postId) {
  return this.findByIdAndUpdate(
    postId,
    { $inc: { sharesCount: 1 } },
    { new: true }
  );
};

postSchema.statics.removeLike = async function(postId, userId) {
  return this.findByIdAndUpdate(
    postId,
    { 
      $pull: { likes: userId },
      $inc: { likesCount: -1 } 
    },
    { new: true }
  );
};

postSchema.statics.addLike = async function(postId, userId) {
  return this.findByIdAndUpdate(
    postId,
    { 
      $addToSet: { likes: userId },
      $inc: { likesCount: 1 } 
    },
    { new: true }
  );
};

postSchema.statics.restoreFromTrash = async function(postId) {
  return this.findByIdAndUpdate(
    postId,
    { 
      'deletion.status': 'active',
      'deletion.movedToTrashAt': null,
      'deletion.scheduledPurgeAt': null,
      'deletion.movedBy': null
    },
    { new: true }
  );
};

postSchema.statics.moveToTrash = async function(postId, adminId) {
  return this.findByIdAndUpdate(
    postId,
    { 
      'deletion.status': 'trash',
      'deletion.movedToTrashAt': new Date(),
      'deletion.scheduledPurgeAt': new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // +60 days
      'deletion.movedBy': adminId
    },
    { new: true }
  );
};

postSchema.statics.incrementComment = async function(postId) {
  return this.findByIdAndUpdate(
    postId,
    { $inc: { commentCount: 1 } },
    { new: true }
  );
};

postSchema.statics.decrementComment = async function(postId) {
  return this.findByIdAndUpdate(
    postId,
    { $inc: { commentCount: -1 } },
    { new: true }
  );
};

postSchema.statics.createDiscoveryPost = async function(entity, cid, reference) {
  const clientConfigService  = require('../services/clientConfigService');
  let config = await clientConfigService.getClientPostConfig(cid);

  if (!config || typeof config !== 'object') {
    config = defaultConfig;
  }

  config = validateConfig({ ...config, modeDiscovery: true });

  return this.create({
    cid,
    entity,
    reference,
    config,
    created_at: new Date(),
    updated_at: new Date()
  });
};

postSchema.statics.getDefaultConfig = function() {
  return defaultConfig;
};

postSchema.index({ 'deletion.status': 1 });
postSchema.index({ 'deletion.scheduledPurgeAt': 1 });
postSchema.index({ cid: 1, 'deletion.status': 1 });
postSchema.index({ entity: 1, cid: 1, 'deletion.status': 1 });
postSchema.index({ title: "text", description: "text", type: "text" });


module.exports = mongoose.model('Post', postSchema);