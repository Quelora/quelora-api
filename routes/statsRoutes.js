// ./routes/statsRoutes.js
const express = require('express');
const router = express.Router();
const statsController = require('../controllers/statsController');
const adminAuthMiddleware = require('../middlewares/adminAuthMiddleware');
const { globalRateLimiter, strictRateLimiter } = require('../middlewares/rateLimiterMiddleware');

router.get('/get',[ globalRateLimiter, strictRateLimiter, adminAuthMiddleware], statsController.getSystemStats);
router.get('/get/geo',[ globalRateLimiter, strictRateLimiter, adminAuthMiddleware], statsController.searchGeoStats);
router.get('/get/posts/list',[ globalRateLimiter, strictRateLimiter, adminAuthMiddleware], statsController.getPostListStats);
router.get('/get/post/:entity',[ globalRateLimiter, strictRateLimiter, adminAuthMiddleware], statsController.getPostAnalytics);

module.exports = router;