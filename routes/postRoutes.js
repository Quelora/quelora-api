// ./routes/postRoutes.js
const express = require('express');
const router = express.Router();
const postController = require('../controllers/postController');
const authMiddleware = require('../middlewares/authMiddleware');
const optionalAuthMiddleware = require('../middlewares/optionalAuthMiddleware');

const { globalRateLimiter, strictRateLimiter } = require('../middlewares/rateLimiterMiddleware');

//Requiere tener token.
router.put('/:entity/like', [globalRateLimiter, strictRateLimiter, authMiddleware] , postController.likePost);
router.put('/:entity/share', [globalRateLimiter, strictRateLimiter, authMiddleware], postController.sharePost);


router.get('/:entity/thread', [ globalRateLimiter, strictRateLimiter, optionalAuthMiddleware], postController.getEntityThread);
router.get('/:entity/replies/:commentId', [ globalRateLimiter, strictRateLimiter, optionalAuthMiddleware], postController.getEntityReplies);
router.get('/stats', [ globalRateLimiter, strictRateLimiter, optionalAuthMiddleware], postController.getPostStats);

router.get('/likes/:entity', [globalRateLimiter, strictRateLimiter, authMiddleware], postController.getPostLikes);
router.get('/analysis/:entity', [globalRateLimiter, strictRateLimiter, authMiddleware], postController.getCommentAnalysis);

router.get('/:entity/nested', [ globalRateLimiter, strictRateLimiter, optionalAuthMiddleware], postController.getNestedComments);

module.exports = router;