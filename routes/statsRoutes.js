// ./routes/statsRoutes.js
const express = require('express');
const router = express.Router();
const statsController = require('../controllers/statsController');
const adminAuthMiddleware = require('../middlewares/adminAuthMiddleware');
const { globalRateLimiter, strictRateLimiter } = require('../middlewares/rateLimiterMiddleware');

router.get('/get',[ globalRateLimiter, strictRateLimiter, adminAuthMiddleware], statsController.getSystemStats);
router.get('/get/geo',[ globalRateLimiter, strictRateLimiter, adminAuthMiddleware], statsController.searchGeoStats);

module.exports = router;