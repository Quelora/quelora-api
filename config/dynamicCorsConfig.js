// ./config/dynamicCorsConfig.js

/**
 * Dynamic CORS configuration middleware.
 * 
 * This function dynamically determines allowed origins based on:
 * - Environment variables (default allowed origins).
 * - Client-specific configuration fetched by client ID (CID) from `clientConfigService`.
 * 
 * Features:
 * - Handles preflight (OPTIONS) requests with automatic approval.
 * - Supports case-insensitive `X-Client-ID` headers.
 * - Allows fine-grained control over allowed and exposed headers.
 * - Can be extended for multi-tenant setups with custom CORS rules per client.
 */

require('dotenv').config();
const { getClientConfig } = require('../services/clientConfigService');
const { DASHBOARD_URL, BASE_URL } = process.env;

async function dynamicCorsConfig(req, callback) {
  // Default allowed origins from environment
  const defaultOrigins = [DASHBOARD_URL, BASE_URL];

  try {
    // Debug: Print all received request headers
    // console.log('\n📋 Headers received:');
    // Object.entries(req.headers).forEach(([key, value]) => {
    //   console.log(`${key}: ${value}`);
    // });

    // Extract Client ID (case-insensitive)
    const cid = req.headers['x-client-id'] || req.headers['X-Client-ID'];

    // Debug: CORS check info
    // const origin = req.get('origin');
    // console.log(`🔍 CORS Check - Origin: ${origin || 'none'}, CID: ${cid || 'none'}, Method: ${req.method}`);

    // Base CORS configuration (common to preflight and actual requests)
    const baseCorsOptions = {
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Client-ID',
        'X-Ip',
        'X-Country',
        'X-Country-Code',
        'X-Region-Code',
        'X-Region',
        'X-City',
        'X-Lat',
        'X-Lon',
        'X-Captcha-Token'
      ],
      exposedHeaders: [
        'X-Client-ID',
        'X-Ip',
        'X-Country',
        'X-Country-Code',
        'X-Region-Code',
        'X-Region',
        'X-City',
        'X-Lat',
        'X-Lon',
        'X-Captcha-Token'
      ],
      credentials: true, // Allow cookies & authorization headers
      maxAge: 86400 // Cache preflight response for 24 hours
    };

    // Special handling for preflight requests
    if (req.method === 'OPTIONS') {
      // console.log('🛫 Preflight Request - Automatic Approval');
      return callback(null, {
        ...baseCorsOptions,
        origin: true // Accept any origin for preflight
      });
    }

    // Handling for actual requests (GET, POST, etc.)
    const corsOptions = {
      ...baseCorsOptions,
      origin: async (origin, cb) => {
        if (!origin) return cb(null, true); // Allow requests without Origin header

        // Determine allowed origins
        let allowedOrigins = defaultOrigins;

        // Check client-specific configuration if CID is provided
        if (cid) {
          const clientConfig = await getClientConfig(cid);
          if (clientConfig?.cors?.enabled && clientConfig.cors.allowedOrigins) {
            allowedOrigins = clientConfig.cors.allowedOrigins;
          }
        }

        // Validate origin
        if (allowedOrigins.includes(origin)) {
          // console.log(`✅ Origin allowed: ${origin}`);
          cb(null, true);
        } else {
          console.log(`🚫 Origin blocked: ${origin} - Allowed: ${allowedOrigins.join(', ')}`);
          // cb(new Error('Not allowed by CORS'));
        }
      }
    };

    callback(null, corsOptions);
  } catch (error) {
    console.error('🔥 CORS Error:', error);
    callback(null, { origin: false });
  }
}

module.exports = dynamicCorsConfig;