// ./routes/profileRoutes.js
const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const authMiddleware = require('../middlewares/authMiddleware');
const { globalRateLimiter, strictRateLimiter } = require('../middlewares/rateLimiterMiddleware');

router.get('/get',[ globalRateLimiter, strictRateLimiter, authMiddleware], profileController.getProfile);
router.get('/:author/get',[ globalRateLimiter, strictRateLimiter, authMiddleware], profileController.getProfile);
router.get('/following/activities',[  globalRateLimiter, strictRateLimiter, authMiddleware], profileController.getFollowingActivities);
router.get('/:author/search', [globalRateLimiter, strictRateLimiter, authMiddleware], profileController.unifiedSearch);
router.get('/search-followers', [globalRateLimiter, strictRateLimiter, authMiddleware], profileController.searchNewFollowers);
router.get('/:mention/mention',[ globalRateLimiter, strictRateLimiter, authMiddleware], profileController.getMention);
router.get('/blocked',[ globalRateLimiter, strictRateLimiter, authMiddleware], profileController.getBlockedList);

router.patch('/update', [globalRateLimiter, strictRateLimiter, authMiddleware], profileController.updateProfile);
router.patch('/settings', [globalRateLimiter, strictRateLimiter, authMiddleware], profileController.updateProfileSettings);
router.patch('/:userId/follow/approve', [globalRateLimiter, strictRateLimiter, authMiddleware], profileController.approveFollowRequest);

router.post('/:entity/bookmark', [ globalRateLimiter, strictRateLimiter, authMiddleware ], profileController.toggleBookmark);
router.post('/:userId/follow', [globalRateLimiter, strictRateLimiter, authMiddleware], profileController.followUser);
router.post('/:userId/block', [globalRateLimiter, strictRateLimiter, authMiddleware], profileController.blockMember);

router.delete('/:userId/follow', [globalRateLimiter, strictRateLimiter, authMiddleware], profileController.unfollowUser);
router.delete('/:userId/cancel-follow', [globalRateLimiter, strictRateLimiter, authMiddleware], profileController.cancelFollowRequest);
router.delete('/:userId/cancel-block', [globalRateLimiter, strictRateLimiter, authMiddleware], profileController.unBlockMember);

module.exports = router;