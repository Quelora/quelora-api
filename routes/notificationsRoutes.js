const express = require('express');
const router = express.Router();
const notificationsController = require('../controllers/notificationsController');
const authMiddleware = require('../middlewares/authMiddleware');
const validateClientHeader = require('../middlewares/validateClientHeaderMiddleware');
const adminAuthMiddleware = require('../middlewares/adminAuthMiddleware');

const { globalRateLimiter, strictRateLimiter } = require('../middlewares/rateLimiterMiddleware');

router.post('/subscribe', [globalRateLimiter, strictRateLimiter, validateClientHeader, authMiddleware], notificationsController.subscribeProfile);
router.post('/unsubscribe', [globalRateLimiter, strictRateLimiter, validateClientHeader, authMiddleware], notificationsController.unsubscribeProfile);
router.post('/validate', [globalRateLimiter, strictRateLimiter, validateClientHeader], notificationsController.validateSubscription);

router.post('/send', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware], notificationsController.sendNotification);
router.get('/search', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware], notificationsController.searchAuthors);
router.get('/config.json', [globalRateLimiter, strictRateLimiter], notificationsController.notificationConfig);
router.get('/generate-vapid-keys', [globalRateLimiter, strictRateLimiter], notificationsController.generateVapidKeys);


module.exports = router;    