// ./routes/authRoutes.js
const express = require('express');
const router = express.Router();
const clientController = require('../controllers/clientController');
const { globalRateLimiter, strictRateLimiter } = require('../middlewares/rateLimiterMiddleware');
const adminAuthMiddleware = require('../middlewares/adminAuthMiddleware');

router.post('/generate-cid', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware], clientController.upsertClient);
router.put('/update-cid', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware], clientController.upsertClient);

router.post('/upsert', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware], clientController.upsertClient);

router.get('/posts', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware], clientController.getClientPosts);
router.get('/posts/:postId/', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware], clientController.getPostComments);
router.put('/upsert-post',[ globalRateLimiter, strictRateLimiter, adminAuthMiddleware], clientController.upsertPost);


router.patch('/trash',[globalRateLimiter, strictRateLimiter, adminAuthMiddleware], clientController.trashPost);
router.patch('/restore', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware], clientController.restorePostFromTrash);

router.post('/moderation', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware], clientController.moderationTest);

router.delete('/delete/:cid', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware], clientController.deleteClient);

router.get('/test', [ ], clientController.testDiscovery);

router.get('/users', [globalRateLimiter, strictRateLimiter, adminAuthMiddleware], clientController.getUsersByClient);

router.get('/logs', [globalRateLimiter, strictRateLimiter,adminAuthMiddleware], clientController.getLogs);

module.exports = router;