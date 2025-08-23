// ./routes/commentRoutes.js
const express = require('express');
const router = express.Router();
const commentController = require('../controllers/commentController');
const authMiddleware = require('../middlewares/authMiddleware');
const captchaMiddleware = require('../middlewares/captchaMiddleware');

const { globalRateLimiter, strictRateLimiter } = require('../middlewares/rateLimiterMiddleware');


router.post('/:entity/comment', [globalRateLimiter, strictRateLimiter, authMiddleware, captchaMiddleware ], commentController.addComment);
router.post('/:entity/comment/:comment/reply',[globalRateLimiter, strictRateLimiter, authMiddleware, captchaMiddleware],commentController.addReply);

router.put('/:entity/comment/:comment/like', [globalRateLimiter, strictRateLimiter, authMiddleware], commentController.likeComment);
router.delete('/:entity/comment/:comment/delete', [globalRateLimiter, strictRateLimiter, authMiddleware ], commentController.deleteComment);
router.patch('/:entity/comment/:comment/edit', [globalRateLimiter, strictRateLimiter, authMiddleware], commentController.editComment);

router.post('/:entity/comment/:comment/report', [globalRateLimiter, strictRateLimiter, authMiddleware], commentController.reportComment);

router.get('/likes/:entity', [globalRateLimiter, strictRateLimiter, authMiddleware], commentController.getPostLikes);
router.get('/likes/:entity/comments/:commentId', [globalRateLimiter, strictRateLimiter, authMiddleware], commentController.getLikes);
router.get('/:entity/comment/:comment/translate', [globalRateLimiter, strictRateLimiter, authMiddleware], commentController.translateComment);

router.get('/audio/:comment', [globalRateLimiter, strictRateLimiter, authMiddleware], commentController.getCommentAudio );


module.exports = router;