const express = require('express');
const router = express.Router();
const ssoController = require('../controllers/ssoController');

const { globalRateLimiter, strictRateLimiter } = require('../middlewares/rateLimiterMiddleware');
router.post('/verify', [globalRateLimiter, strictRateLimiter], ssoController.ssoVerify);

module.exports = router;    