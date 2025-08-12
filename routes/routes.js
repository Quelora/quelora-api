// // ./routes/routes.js
const postRoutes = require('./postRoutes');
const commentRoutes = require('./commentRoutes');
const authRoutes = require('./authRoutes');
const profileRoutes = require('./profileRoutes');
const statsRoutes = require('./statsRoutes');
const clientRoutes = require('./clientRoutes');
const ssoRoutes = require('./ssoRoutes');

const notificationsRoutes = require('./notificationsRoutes');
const validateClientHeader = require('../middlewares/validateClientHeaderMiddleware');
const extractGeoData = require('../middlewares/extractGeoDataMiddleware');

module.exports = (app) => {
  app.use('/profile', [validateClientHeader, extractGeoData], profileRoutes);
  app.use('/posts', [validateClientHeader, extractGeoData], postRoutes);
  app.use('/comments', [validateClientHeader, extractGeoData], commentRoutes);
  app.use('/notifications', notificationsRoutes);
  app.use('/sso', ssoRoutes);

  app.use('/stats', statsRoutes);
  app.use('/auth', authRoutes);
  app.use('/client', clientRoutes);
};