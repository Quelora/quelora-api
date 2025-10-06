const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { encrypt, decrypt } = require('../utils/cipher');
const Post = require('./Post'); // Import Post model to access defaultConfig

// Encryption key from .env
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

// Allowed configuration schema
const allowedConfigKeys = ['login', 'moderation', 'toxicity', 'translation', 'geolocation', 'cors', 'language', 'modeDiscovery', 'discoveryDataUrl', 'entityConfig', 'captcha'];

// Sub-schema for user-associated clients
const clientSchema = new mongoose.Schema({
  cid: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    unique: true,
    match: [/^QU-[A-Z0-9]{8}-[A-Z0-9]{5}$/, 'Invalid CID format. Must be QU-XXXXXXXX-XXXXX']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [50, 'Description cannot exceed 50 characters']
  },
  apiUrl: {
    type: String,
    trim: true,
    maxlength: [300, 'ApiURL cannot exceed 300 characters']
  },
  config: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
    required: true,
    validate: {
      validator: function(config) {
        // Validate main keys
        const configKeys = Object.keys(config);
        const invalidKeys = configKeys.filter(key => !allowedConfigKeys.includes(key));
        if (invalidKeys.length > 0) {
          throw new Error(`Invalid config keys: ${invalidKeys.join(', ')}`);
        }

        // Validate each configuration module
        for (const [moduleName, moduleConfig] of Object.entries(config)) {
          if (['modeDiscovery'].includes(moduleName)) {
            if (typeof moduleConfig !== 'boolean') {
              throw new Error(`Configuration for '${moduleName}' must be a boolean`);
            }
            continue;
          }

          if (['discoveryDataUrl'].includes(moduleName)) {
            if (typeof moduleConfig !== 'string') {
              throw new Error(`Configuration for '${moduleName}' must be a string`);
            }
            continue;
          }

          if (typeof moduleConfig !== 'object' || Array.isArray(moduleConfig) || moduleConfig === null) {
            throw new Error(`Configuration for '${moduleName}' must be an object`);
          }

          this.validateModule(moduleName, moduleConfig);
        }
        
        return true;
      },
      message: props => props.reason.message || 'Invalid configuration'
    }
  },
  postConfig: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
    required: true,
    validate: {
      validator: async function(postConfig) {
        try {
          const defaultConfig = Post.getDefaultConfig();

          const postConfigKeys = Object.keys(postConfig);

          // Check for invalid top-level keys
          const invalidKeys = postConfigKeys.filter(key => !Object.keys(defaultConfig).includes(key));
          if (invalidKeys.length > 0) {
            throw new Error(`Invalid postConfig keys: ${invalidKeys.join(', ')}`);
          }

          // Validate nested structures
          for (const [key, value] of Object.entries(postConfig)) {
            const defaultValue = defaultConfig[key];

            if (key === 'visibility') {
              if (typeof value !== 'string' || !['public', 'private', 'followers'].includes(value)) {
                throw new Error(`Invalid value for visibility: ${value}`);
              }
            } else if (key === 'category') {
              if (typeof value !== 'string' || value.length > 50) {
                throw new Error(`Category must be a string with max length 50`);
              }
            } else if (key === 'tags') {
              if (!Array.isArray(value) || value.some(tag => typeof tag !== 'string' || tag.length > 30)) {
                throw new Error(`Tags must be an array of strings with max length 30`);
              }
              if (value.length > 10) {
                throw new Error(`Maximum 10 tags allowed`);
              }
            } else if (typeof defaultValue === 'object' && defaultValue !== null && !Array.isArray(defaultValue)) {
              if (typeof value !== 'object' || Array.isArray(value) || value === null) {
                throw new Error(`Configuration for '${key}' must be an object`);
              }
              for (const [subKey, subValue] of Object.entries(value)) {
                if (!(subKey in defaultValue)) {
                  throw new Error(`Invalid sub-key in ${key}: ${subKey}`);
                }
                const defaultSubValue = defaultValue[subKey];
                if (typeof defaultSubValue === 'boolean' && typeof subValue !== 'boolean') {
                  throw new Error(`'${subKey}' in ${key} must be a boolean`);
                } else if (typeof defaultSubValue === 'number' && (typeof subValue !== 'number' || subValue < 0)) {
                  throw new Error(`'${subKey}' in ${key} must be a non-negative number`);
                } else if (typeof defaultSubValue === 'string') {
                  if (subKey === 'post_language' && (typeof subValue !== 'string' || subValue.length > 10)) {
                    throw new Error(`'post_language' must be a string with max length 10`);
                  }
                  if (subKey === 'moderation_prompt' && (typeof subValue !== 'string' || subValue.length > 200)) {
                    throw new Error(`'moderation_prompt' must be a string with max length 200`);
                  }
                  if ((subKey === 'scheduled_time' || subKey === 'expire_at') && (typeof subValue !== 'string' || isNaN(Date.parse(subValue)))) {
                    throw new Error(`'${subKey}' must be a valid date string`);
                  }
                } else if (subKey === 'banned_words') {
                  if (!Array.isArray(subValue) || subValue.some(word => typeof word !== 'string' || word.length > 50)) {
                    throw new Error(`Banned words must be an array of strings with max length 50`);
                  }
                }
              }
            } else {
              throw new Error(`Unexpected configuration type for '${key}'`);
            }
          }
          return true;
        } catch (error) {
          console.error('Validation error:', error.message);
          throw error;
        }
      },
      message: props => props.reason.message || 'Invalid postConfig configuration'
    }
  },
  vapid: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
    required: false,
    validate: {
      validator: function(vapid) {
        // Validar publicKey solo si no está vacío
        if (vapid.publicKey !== undefined && vapid.publicKey !== "") {
          if (typeof vapid.publicKey !== 'string' || vapid.publicKey.length > 88) {
            throw new Error('publicKey must be a string up to 88 characters');
          }
        }

        // Validar privateKey solo si no está vacío
        if (vapid.privateKey !== undefined && vapid.privateKey !== "") {
          if (typeof vapid.privateKey !== 'string' || vapid.privateKey.length > 44) {
            throw new Error('privateKey must be a string up to 44 characters');
          }
        }

        // Validar email solo si no está vacío
        if (vapid.email !== undefined && vapid.email !== "") {
          if (typeof vapid.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(vapid.email) || vapid.email.length > 254) {
            throw new Error('email must be a valid email address with max length 254');
          }
        }

        // Validar iconBase64 solo si no está vacío
        if (vapid.iconBase64 !== undefined && vapid.iconBase64 !== "") {
          if (typeof vapid.iconBase64 !== 'string') {
            throw new Error('iconBase64 must be a string');
          }
          if (vapid.iconBase64.length > 0) {
            try {
              const buffer = Buffer.from(vapid.iconBase64, 'base64');
              if (buffer.length > 100 * 1024) {
                throw new Error('iconBase64 size must not exceed 100KB');
              }
            } catch (error) {
              throw new Error('Invalid base64 string for iconBase64');
            }
          }
        }

        return true;
      },
      message: props => props.reason.message || 'Invalid VAPID configuration'
    }
  },
  email: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
    required: false,
    validate: {
      validator: function(email) {
        // Validar smtp_host solo si no está vacío
        if (email.smtp_host !== undefined && email.smtp_host !== "") {
          if (typeof email.smtp_host !== 'string' || email.smtp_host.length < 3 || email.smtp_host.length > 100) {
            throw new Error('smtp_host must be a string between 3 and 100 characters');
          }
        }

        // Validar smtp_port solo si no está vacío
        if (email.smtp_port !== undefined && email.smtp_port !== "") {
          const portNum = parseInt(email.smtp_port);
          if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
            throw new Error('smtp_port must be a valid number between 1 and 65535');
          }
        }

        // Validar smtp_user solo si no está vacío
        if (email.smtp_user !== undefined && email.smtp_user !== "") {
          if (typeof email.smtp_user !== 'string' || email.smtp_user.length < 3 || email.smtp_user.length > 100) {
            throw new Error('smtp_user must be a string between 3 and 100 characters');
          }
        }

        // Validar smtp_pass solo si no está vacío
        if (email.smtp_pass !== undefined && email.smtp_pass !== "") {
          if (typeof email.smtp_pass !== 'string' || email.smtp_pass.length < 6 || email.smtp_pass.length > 100) {
            throw new Error('smtp_pass must be a string between 6 and 100 characters');
          }
        }

        return true;
      },
      message: props => props.reason.message || 'Invalid email configuration'
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

clientSchema.index({ cid: 1 }, { unique: true });

// Method to validate individual modules
clientSchema.methods.validateModule = function(moduleName, moduleConfig) {
  // Validate enabled if it exists
  if ('enabled' in moduleConfig && typeof moduleConfig.enabled !== 'boolean') {
    throw new Error(`'enabled' field in ${moduleName} must be boolean`);
  }

  // Module-specific validations
  switch (moduleName) {
    case 'login':
      this.validateLogin(moduleConfig);
      break;
    case 'moderation':
      this.validateModeration(moduleConfig);
      break;
    case 'toxicity':
      this.validateToxicity(moduleConfig);
      break;
    case 'translation':
      this.validateTranslation(moduleConfig);
      break;
    case 'geolocation':
      this.validateGeolocation(moduleConfig);
      break;
    case 'cors':
      this.validateCors(moduleConfig);
      break;
    case 'entityConfig':
      this.validateEntityConfig(moduleConfig);
      break;
    case 'captcha':
      this.validateCaptcha(moduleConfig);
      break;
  }
};

// Specific validation for login
clientSchema.methods.validateLogin = function(loginConfig) {
  if (loginConfig.baseUrl && !/^https?:\/\/.+\..+/.test(loginConfig.baseUrl)) {
    throw new Error('Base URL must be a valid URL');
  }

  // Validación para jwtSecret
  if (loginConfig.jwtSecret && loginConfig.jwtSecret.length > 100) {
    throw new Error('JWT Secret cannot exceed 100 characters');
  }

  if (loginConfig.providers && !Array.isArray(loginConfig.providers)) {
    throw new Error('Providers must be an array');
  }

  if (loginConfig.providerDetails) {
    for (const [providerName, providerConfig] of Object.entries(loginConfig.providerDetails)) {
      if (providerConfig.clientId && providerConfig.clientId.length > 100) {
        throw new Error(`clientId for ${providerName} cannot exceed 100 characters`);
      }
      if (providerConfig.clientSecret && providerConfig.clientSecret.length > 100) {
        throw new Error(`clientSecret for ${providerName} cannot exceed 100 characters`);
      }
      if (providerConfig.clientSecretCipher && typeof providerConfig.clientSecretCipher !== 'string') {
        throw new Error(`clientSecretCipher for ${providerName} must be a string`);
      }
    }
  }
};

// Specific validation for moderation
clientSchema.methods.validateModeration = function(moderationConfig) {
  if (moderationConfig.apiKey && moderationConfig.apiKey.length > 255) {
    throw new Error('Moderation API key cannot exceed 255 characters');
  }

  if (moderationConfig.apiKeyCipher && typeof moderationConfig.apiKeyCipher !== 'string') {
    throw new Error('apiKeyCipher must be a string');
  }

  if (moderationConfig.prompt && moderationConfig.prompt.length > 5000) {
    throw new Error('Moderation prompt cannot exceed 5000 characters');
  }

  if (moderationConfig.configJson && typeof moderationConfig.configJson !== 'object') {
    throw new Error('configJson must be an object');
  }
};

// Specific validation for toxicity
clientSchema.methods.validateToxicity = function(toxicityConfig) {
  if (toxicityConfig.apiKey && toxicityConfig.apiKey.length > 255) {
    throw new Error('Toxicity API key cannot exceed 255 characters');
  }

  if (toxicityConfig.apiKeyCipher && typeof toxicityConfig.apiKeyCipher !== 'string') {
    throw new Error('apiKeyCipher must be a string');
  }

  if (toxicityConfig.configJson && typeof toxicityConfig.configJson !== 'object') {
    throw new Error('configJson must be an object');
  }
};

// Specific validation for translation
clientSchema.methods.validateTranslation = function(translationConfig) {
  if (translationConfig.apiKey && translationConfig.apiKey.length > 255) {
    throw new Error('Translation API key cannot exceed 255 characters');
  }

  if (translationConfig.apiKeyCipher && typeof translationConfig.apiKeyCipher !== 'string') {
    throw new Error('apiKeyCipher must be a string');
  }

  if (translationConfig.configJson && typeof translationConfig.configJson !== 'object') {
    throw new Error('configJson must be an object');
  }
};

// Specific validation for geolocation
clientSchema.methods.validateGeolocation = function(geolocationConfig) {
  if (geolocationConfig.apiKey && geolocationConfig.apiKey.length > 255) {
    throw new Error('Geolocation API key cannot exceed 255 characters');
  }

  if (geolocationConfig.apiKeyCipher && typeof geolocationConfig.apiKeyCipher !== 'string') {
    throw new Error('apiKeyCipher must be a string');
  }
};

// Specific validation for cors
clientSchema.methods.validateCors = function(corsConfig) {
  if ('allowedOrigins' in corsConfig && !Array.isArray(corsConfig.allowedOrigins)) {
    throw new Error('allowedOrigins must be an array');
  }

  if (corsConfig.enabled && (!corsConfig.allowedOrigins || corsConfig.allowedOrigins.length === 0)) {
    throw new Error('At least one allowed origin is required when CORS is enabled');
  }

  if (corsConfig.allowedOrigins) {
    if (corsConfig.allowedOrigins.length > 50) {
      throw new Error('Number of allowed origins cannot exceed 50');
    }

    for (const origin of corsConfig.allowedOrigins) {
      if (typeof origin !== 'string') {
        throw new Error('Each origin must be a string');
      }
      if (origin.length > 255) {
        throw new Error(`Origin ${origin} cannot exceed 255 characters`);
      }

      if (!/^(https?:\/\/)?(localhost|[\w-]+(\.[\w-]+)+|(\d{1,3}\.){3}\d{1,3}|\[[a-f0-9:]+\])(:\d+)?(\/.*)?$/i.test(origin)) {
        throw new Error(`Origin ${origin} is not a valid URL or IP address`);
      }
    }
  }
};

// Specific validation for entityConfig
clientSchema.methods.validateEntityConfig = function(entityConfig) {
  // Validate selector
  if (!entityConfig.selector || typeof entityConfig.selector !== 'string' || entityConfig.selector.length > 100) {
    throw new Error('selector must be a non-empty string with max length 100');
  }

  // Validate entityIdAttribute
  if (!entityConfig.entityIdAttribute || typeof entityConfig.entityIdAttribute !== 'string' || entityConfig.entityIdAttribute.length > 100) {
    throw new Error('entityIdAttribute must be a non-empty string with max length 100');
  }

  // Validate interactionPlacement
  if (!entityConfig.interactionPlacement || typeof entityConfig.interactionPlacement !== 'object' || Array.isArray(entityConfig.interactionPlacement) || entityConfig.interactionPlacement === null) {
    throw new Error('interactionPlacement must be a non-null object');
  }

  // Validate interactionPlacement.position
  if (!entityConfig.interactionPlacement.position || !['before', 'after', 'inside'].includes(entityConfig.interactionPlacement.position)) {
    throw new Error('interactionPlacement.position must be either "before", "after", or "inside"');
  }

  // Validate interactionPlacement.relativeTo
  if (!entityConfig.interactionPlacement.relativeTo || typeof entityConfig.interactionPlacement.relativeTo !== 'string' || entityConfig.interactionPlacement.relativeTo.length > 100) {
    throw new Error('interactionPlacement.relativeTo must be a non-empty string with max length 100');
  }
};

// Specific validation for captcha
clientSchema.methods.validateCaptcha = function(captchaConfig) {
  // Validate enabled
  if ('enabled' in captchaConfig && typeof captchaConfig.enabled !== 'boolean') {
    throw new Error('captcha.enabled must be a boolean');
  }

  // Validate provider
  if ('provider' in captchaConfig && !['turnstile', 'recaptcha'].includes(captchaConfig.provider)) {
    throw new Error('captcha.provider must be either "turnstile" or "recaptcha"');
  }

  // Validate siteKey
  if (captchaConfig.enabled && (!captchaConfig.siteKey || typeof captchaConfig.siteKey !== 'string' || captchaConfig.siteKey.length > 250)) {
    throw new Error('captcha.siteKey must be a non-empty string with max length 250 when enabled');
  }

  // Validate secretKey
  //if (captchaConfig.enabled && (!captchaConfig.secretKey || typeof captchaConfig.secretKey !== 'string' || captchaConfig.secretKey.length > 250)) {
  //  throw new Error('captcha.secretKey must be a non-empty string with max length 250 when enabled');
  //}

  // Validate credentialsJson
  if ('credentialsJson' in captchaConfig) {
    if (typeof captchaConfig.credentialsJson !== 'string') {
      throw new Error('captcha.credentialsJson must be a string');
    }
    if (captchaConfig.credentialsJson.length > 5000) {
      throw new Error('captcha.credentialsJson cannot exceed 5000 characters');
    }
    if (captchaConfig.credentialsJson && !this.isValidJson(captchaConfig.credentialsJson)) {
      throw new Error('captcha.credentialsJson must be a valid JSON string');
    }
  }
};

// Helper method to validate JSON
clientSchema.methods.isValidJson = function(jsonString) {
  try {
    JSON.parse(jsonString);
    return true;
  } catch (e) {
    return false;
  }
};

// Middleware to encrypt sensitive keys before saving
clientSchema.pre('save', function(next) {
  if (this.isModified('config')) {
    const config = this.config;
    
    // Encrypt keys in providerDetails
    if (config.login?.providerDetails) {
      for (const provider of Object.values(config.login.providerDetails)) {
        if (provider.clientSecret && provider.clientSecret !== '') {
          provider.clientSecretCipher = encrypt(provider.clientSecret, ENCRYPTION_KEY);
          provider.clientSecret = undefined; // Remove plaintext key
        }
      }
    }
    
    // Encrypt apiKeys in different modules
    const modulesToEncrypt = ['moderation', 'toxicity', 'translation', 'geolocation'];
    for (const moduleName of modulesToEncrypt) {
      if (config[moduleName]?.apiKey && config[moduleName].apiKey !== '') {
        config[moduleName].apiKeyCipher = encrypt(config[moduleName].apiKey, ENCRYPTION_KEY);
        config[moduleName].apiKey = undefined; // Remove plaintext key
      }
    }
    
    if (config.login?.jwtSecret && config.login.jwtSecret !== '') {
      config.login.jwtSecretCipher = encrypt(config.login.jwtSecret, ENCRYPTION_KEY);
      config.login.jwtSecret = undefined; // Remove plaintext key
    }

    // Encrypt captcha secretKey and credentialsJson
    if (config.captcha?.secretKey && config.captcha.secretKey !== '') {
      config.captcha.secretKeyCipher = encrypt(config.captcha.secretKey, ENCRYPTION_KEY);
      config.captcha.secretKey = undefined; // Remove plaintext key
    }
    if (config.captcha?.credentialsJson && config.captcha.credentialsJson !== '') {
      config.captcha.credentialsJsonCipher = encrypt(config.captcha.credentialsJson, ENCRYPTION_KEY);
      config.captcha.credentialsJson = undefined; // Remove plaintext JSON
    }

    this.markModified('config');
  }

  // Encrypt smtp_pass in email configuration
  if (this.isModified('email') && this.email?.smtp_pass && this.email.smtp_pass !== '') {
    this.email.smtp_passCipher = encrypt(this.email.smtp_pass, ENCRYPTION_KEY);
    this.email.smtp_pass = undefined; // Remove plaintext password
    this.markModified('email');
  }

  // Encrypt privateKey in vapid configuration
  if (this.isModified('vapid') && this.vapid?.privateKey) {
    this.vapid.privateKeyCipher = encrypt(this.vapid.privateKey, ENCRYPTION_KEY);
    this.vapid.privateKey = undefined; // Remove plaintext key
    this.markModified('vapid');
  }

  next();
});

// Transformation to decrypt when converting to JSON
clientSchema.set('toJSON', {
  transform: function(doc, ret) {
    if (ret.config?.login?.providerDetails) {
      for (const provider of Object.values(ret.config.login.providerDetails)) {
        if (provider.clientSecretCipher) {
          provider.clientSecret = decrypt(provider.clientSecretCipher, ENCRYPTION_KEY);
          provider.clientSecretCipher = undefined;
        }
      }
    }
    
    if (ret.config?.login?.jwtSecretCipher) {
      ret.config.login.jwtSecret = decrypt(ret.config.login.jwtSecretCipher, ENCRYPTION_KEY);
      ret.config.login.jwtSecretCipher = undefined;
    }

    const modulesToDecrypt = ['moderation', 'toxicity', 'translation', 'geolocation'];
    for (const moduleName of modulesToDecrypt) {
      if (ret.config?.[moduleName]?.apiKeyCipher) {
        ret.config[moduleName].apiKey = decrypt(ret.config[moduleName].apiKeyCipher, ENCRYPTION_KEY);
        ret.config[moduleName].apiKeyCipher = undefined;
      }
    }

    if (ret.config?.captcha?.secretKeyCipher) {
      ret.config.captcha.secretKey = decrypt(ret.config.captcha.secretKeyCipher, ENCRYPTION_KEY);
      ret.config.captcha.secretKeyCipher = undefined;
    }

    if (ret.config?.captcha?.credentialsJsonCipher) {
      ret.config.captcha.credentialsJson = decrypt(ret.config.captcha.credentialsJsonCipher, ENCRYPTION_KEY);
      ret.config.captcha.credentialsJsonCipher = undefined;
    }
    
    if (ret.vapid?.privateKeyCipher) {
      ret.vapid.privateKey = decrypt(ret.vapid.privateKeyCipher, ENCRYPTION_KEY);
      ret.vapid.privateKeyCipher = undefined;
    }

    if (ret.email?.smtp_passCipher) {
      ret.email.smtp_pass = decrypt(ret.email.smtp_passCipher, ENCRYPTION_KEY);
      ret.email.smtp_passCipher = undefined;
    }

    return ret;
  }
});

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    maxlength: 50,
    match: [/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers and underscores']
  },
  password: {
    type: String,
    required: true,
    minlength: [8, 'Password must be at least 8 characters long']
  },
  role: {
    type: String,
    enum: ['admin', 'editor'],
    default: 'editor'
  },
  clients: [clientSchema],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Static method to generate a unique CID
userSchema.statics.generateUniqueCID = async function(maxAttempts = 5) {
  const User = this;
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;
    const timestampPart = Date.now().toString(36).toUpperCase();
    const randomPart = Math.random().toString(36).substring(2, 7).toUpperCase();
    const candidateCID = `QU-${timestampPart}-${randomPart}`;
    const exists = await User.findOne({
      'clients.cid': candidateCID
    });

    if (!exists) {
      return candidateCID;
    }
  }

  throw new Error(`Failed to generate unique CID after ${maxAttempts} attempts`);
};

// Middleware to add default CID for new admin users and encrypt password
userSchema.pre('save', async function(next) {
  if (this.isModified('password')) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }

  if (this.isNew && this.role === 'admin' && this.clients.length === 0) {
    try {
      const defaultCID = await this.constructor.generateUniqueCID();
      this.clients.push({
        cid: defaultCID,
        description: 'Default admin client'
      });
    } catch (error) {
      return next(error);
    }
  }

  this.updatedAt = Date.now();
  next();
});

// Method to compare passwords
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to update a specific CID
userSchema.methods.updateCID = async function(cid, newDescription, apiUrl, newConfig, postConfig, vapid, email) {
  const clientIndex = this.clients.findIndex(client => client.cid === cid);

  if (clientIndex === -1) {
    throw new Error('CID not found in user clients');
  }

  this.clients[clientIndex].description = newDescription;
  this.clients[clientIndex].apiUrl = apiUrl;
  this.clients[clientIndex].postConfig = postConfig;
  this.clients[clientIndex].vapid = vapid;
  this.clients[clientIndex].email = email;

  if (newConfig) {
    const configKeys = Object.keys(newConfig);
    if (!configKeys.every(key => allowedConfigKeys.includes(key))) {
      throw new Error('New config contains invalid keys. Allowed keys are: ' + allowedConfigKeys.join(', '));
    }
    this.clients[clientIndex].config = newConfig;
  }

  this.markModified('clients');
  await this.save();

  return this.clients[clientIndex];
};

// Method to decrypt configuration
userSchema.methods.decryptConf = function(conf) {
  const decryptedConf = JSON.parse(JSON.stringify(conf)); // Deep clone
  
  // Decrypt providerDetails
  if (decryptedConf.login?.providerDetails) {
    for (const provider of Object.values(decryptedConf.login.providerDetails)) {
      if (provider.clientSecretCipher) {
        provider.clientSecret = decrypt(provider.clientSecretCipher, ENCRYPTION_KEY);
        provider.clientSecretCipher = undefined;
      }
    }
  }
  
  // Decrypt apiKeys in modules
  const modulesToDecrypt = ['moderation', 'toxicity', 'translation', 'geolocation'];
  for (const moduleName of modulesToDecrypt) {
    if (decryptedConf[moduleName]?.apiKeyCipher) {
      decryptedConf[moduleName].apiKey = decrypt(decryptedConf[moduleName].apiKeyCipher, ENCRYPTION_KEY);
      decryptedConf[moduleName].apiKeyCipher = undefined;
    }
  }

  // Decrypt jwtSecret
  if (decryptedConf.login?.jwtSecretCipher) {
    decryptedConf.login.jwtSecret = decrypt(decryptedConf.login.jwtSecretCipher, ENCRYPTION_KEY);
    decryptedConf.login.jwtSecretCipher = undefined;
  }

  // Decrypt captcha fields
  if (decryptedConf.captcha?.secretKeyCipher) {
    decryptedConf.captcha.secretKey = decrypt(decryptedConf.captcha.secretKeyCipher, ENCRYPTION_KEY);
    decryptedConf.captcha.secretKeyCipher = undefined;
  }
  if (decryptedConf.captcha?.credentialsJsonCipher) {
    decryptedConf.captcha.credentialsJson = decrypt(decryptedConf.captcha.credentialsJsonCipher, ENCRYPTION_KEY);
    decryptedConf.captcha.credentialsJsonCipher = undefined;
  }
  
  return decryptedConf;
};

// Method to decrypt vapid
userSchema.methods.decryptVapid = function(vapid) {
  const decryptedVapid = JSON.parse(JSON.stringify(vapid)); // Deep clone

  if (decryptedVapid.privateKeyCipher) {
    decryptedVapid.privateKey = decrypt(decryptedVapid.privateKeyCipher, ENCRYPTION_KEY);
    decryptedVapid.privateKeyCipher = undefined;
  }

  return decryptedVapid;
};

// Method to decrypt email
userSchema.methods.decryptEmail = function(email) {
  const decryptedEmail = JSON.parse(JSON.stringify(email)); // Deep clone

  if (decryptedEmail.smtp_passCipher) {
    decryptedEmail.smtp_pass = decrypt(decryptedEmail.smtp_passCipher, ENCRYPTION_KEY);
    decryptedEmail.smtp_passCipher = undefined;
  }

  return decryptedEmail;
};

// Method to add a new client
userSchema.methods.addClient = async function(description) {
  const newCID = await this.constructor.generateUniqueCID();
  this.clients.push({
    cid: newCID,
    description
  });
  await this.save();
  return newCID;
};

module.exports = mongoose.model('User', userSchema);