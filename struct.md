├── .env
├── .env.example
├── .gitignore
├── LICENSE
├── app.js
├── config
│   ├── commentAnalysisPromptConfig.js
│   ├── corsClientConfig.js
│   ├── dynamicCorsConfig.js
│   ├── helmetConfig.js
│   └── moderationPromptConfig.js
├── controllers
│   ├── authController.js
│   ├── clientController.js
│   ├── commentController.js
│   ├── notificationsController.js
│   ├── postController.js
│   ├── profileController.js
│   ├── ssoController.js
│   └── statsController.js
├── credentials
│   └── dialogue-449920-key.json
├── cron
│   ├── discoveryJob.js
│   └── statsJob.js
├── db
│   ├── .gitkeep
│   ├── COPYRIGHT.txt
│   ├── GeoLite2-City.mmdb
│   ├── LICENSE.txt
│   └── README.txt
├── db.js
├── empty.MD
├── locale
│   ├── en.json
│   └── es.json
├── middlewares
│   ├── adminAuthMiddleware.js
│   ├── authMiddleware.js
│   ├── captchaMiddleware.js
│   ├── extractGeoDataMiddleware.js
│   ├── optionalAuthMiddleware.js
│   ├── rateLimiterMiddleware.js
│   └── validateClientHeaderMiddleware.js
├── models
│   ├── Activity.js
│   ├── Comment.js
│   ├── CommentAnalysis.js
│   ├── CommentAudio.js
│   ├── GeoStats.js
│   ├── Post.js
│   ├── Profile.js
│   ├── ProfileBlock.js
│   ├── ProfileBookmark.js
│   ├── ProfileComment.js
│   ├── ProfileFollowRequest.js
│   ├── ProfileFollower.js
│   ├── ProfileFollowing.js
│   ├── ProfileLike.js
│   ├── ProfileShare.js
│   ├── ReportedComment.js
│   ├── Stats.js
│   └── User.js
├── moderationProviders
│   ├── DeepSeekModerationProvider.js
│   ├── GeminiModerationProvider.js
│   ├── GrokModerationProvider.js
│   ├── ModerationProvider.js
│   └── OpenAIModerationProvider.js
├── nodemon.json
├── package-lock.json
├── package.json
├── public
│   ├── .gitkeep
│   └── assets
│       ├── .gitkeep
│       ├── 114744396528341892492.background.webp
│       ├── 114744396528341892492.webp
│       ├── 1f912bd89888338fed818a2d24a7f404ff58412679d584870c0f4ec35c43ea21.background.webp
│       ├── 1f912bd89888338fed818a2d24a7f404ff58412679d584870c0f4ec35c43ea21.webp
│       └── b48981f49be5e55337db2fcff83376c3f0cd988d76b342a97aa5d2a2ca8b23c3.background.webp
├── read.MD
├── routes
│   ├── authRoutes.js
│   ├── clientRoutes.js
│   ├── commentRoutes.js
│   ├── notificationsRoutes.js
│   ├── postRoutes.js
│   ├── profileRoutes.js
│   ├── routes.js
│   ├── ssoRoutes.js
│   └── statsRoutes.js
├── seed
│   ├── SeedFollowers.js
│   ├── comments.txt
│   ├── seedAdminUser.js
│   ├── seedComments.js
│   ├── seedFakerUser.js
│   └── seedVAPID.js
├── services
│   ├── activityService.js
│   ├── authService.js
│   ├── cacheService.js
│   ├── captchaService.js
│   ├── clientConfigService.js
│   ├── commentAnalysisService.js
│   ├── emailService.js
│   ├── i18nService.js
│   ├── languageService.js
│   ├── loggerService.js
│   ├── moderateService.js
│   ├── profileService.js
│   ├── puppeteerService.js
│   ├── pushNotificationService.js
│   ├── pushService.js
│   ├── ssoService.js
│   ├── statsService.js
│   ├── toxicityService.js
│   └── translateService.js
├── ssoProviders
│   ├── AppleProvider.js
│   ├── FacebookProvider.js
│   ├── GoogleProvider.js
│   └── XProvider.js
├── struct.md
└── utils
    ├── cacheUtils.js
    ├── cipher.js
    ├── commentAnalysisUtils.js
    ├── deepMerge.js
    ├── firstDefined.js
    ├── followStatusUtils.js
    ├── formatComment.js
    ├── notificationUtils.js
    ├── password.js
    ├── profileUtils.js
    ├── recordStatsActivity.js
    └── textUtils.js
