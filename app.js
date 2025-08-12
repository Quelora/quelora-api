//app.js
require('dotenv').config();
const express = require('express');
const helmetConfig = require('./config/helmetConfig');
const cors = require('cors');
const dynamicCorsConfig = require('./config/dynamicCorsConfig');
const setupRoutes = require('./routes/routes'); 
const connectDB = require('./db'); 
const statsJob = require('./cron/statsJob'); 
const discoveryJob =  require('./cron/discoveryJob'); 
const { cacheService } = require('./services/cacheService');
const path = require('path');

// Conectar a la base de datos
connectDB();

const app = express();
const port = process.env.PORT;
const baseURL = process.env.BASE_URL;

app.set('trust proxy', 2);;

// Statics - Serve assets without CORS restrictions
app.use('/assets', (req, res, next) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  });
  express.static(path.join(__dirname, 'public/assets'))(req, res, next);
});

//Helmet
app.use(helmetConfig); 

// Api CORS
app.use(cors(dynamicCorsConfig));
app.options('*', cors(dynamicCorsConfig))

// Middlewares
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));

// Routes
setupRoutes(app); // Configura las rutas

// Middleware post-rutas
app.use((req, res, next) => {
  const originalSend = res.send;
  let responseBody;

  // We intercept res.send to capture the body sent to the client
  res.send = function (body) {
    responseBody = body;
    return originalSend.call(this, body);
  };

  //Clear Cache and Save Activity
  res.on('finish', () => {
    const { method, path } = req;
    const statusCode = res.statusCode;
    const params = {};
    const cid = req.cid;

    //Rebuild the params
    if (req.route?.path && req._parsedUrl?.pathname) {
      const routeSegments = req.route.path.split('/').filter(Boolean);
      const actualSegments = req._parsedUrl.pathname.split('/').filter(Boolean);

      // Calculate offset between pathname and route.path
      const offset = actualSegments.length - routeSegments.length;

      for (let i = 0; i < routeSegments.length; i++) {
        const routeSegment = routeSegments[i];
        const actualSegment = actualSegments[i + offset];

        if (routeSegment.startsWith(':')) {
          const key = routeSegment.slice(1);
          params[key] = actualSegment;
        }
      }
    }

    // Switch by HTTP method
    switch (method) {
      case 'GET':
        console.log(`📌 GET ${path} → Status: ${statusCode}`);
        break;

      case 'POST':
        //Cache  thread
        if(params?.entity) {
          cacheService.deleteByPattern(`cid:${cid}:thread:${params.entity}:*`);
        }
        //Cache  thread & comments
        if(params?.comment) {
          cacheService.deleteByPattern(`*:${params.comment}:*`);
        }
        break;

      case 'PUT':
        console.log(`📝 PUT ${path} → Status: ${statusCode}`);
        //Cache thread
        if(params?.entity) {
          cacheService.deleteByPattern(`cid:${cid}:thread:${params.entity}:*`);
        }
        //Cache  thread &&  comments
        if(params?.comment) {
          cacheService.deleteByPattern(`*:${params.comment}:*`);
        }
        break;

      case 'PATCH':
        console.log(`📝 PATCH ${path} → Status: ${statusCode}`);
        //Cache thread
        if(params?.entity) {
          cacheService.deleteByPattern(`cid:${cid}:thread:${params.entity}:*`);
        }
        //Cache thread & comments
        if(params?.comment) {
          cacheService.deleteByPattern(`*:${params.comment}:*`);
        }
        break;

      case 'DELETE':
         console.log(`🗑️ DELETE ${path} → Status: ${statusCode}`);
        break;

      default:
        console.log(`🔵 ${method} ${path} → Status: ${statusCode}`);
    }
  });

  next();
});

// Start the cron job
statsJob;
discoveryJob;

// Server
app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Servidor corriendo en ${baseURL}`);
});