// ./routes/authRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { globalRateLimiter, strictRateLimiter } = require('../middlewares/rateLimiterMiddleware');
const adminAuthMiddleware = require('../middlewares/adminAuthMiddleware');

router.post('/generate-token', [ globalRateLimiter, strictRateLimiter], authController.generateToken);
router.post('/renew-token', [globalRateLimiter], authController.renewAdminToken);
router.post('/change-password', [globalRateLimiter, adminAuthMiddleware], authController.updatePassword);

module.exports = router;