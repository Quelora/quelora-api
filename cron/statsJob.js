// ./cron/statsJob.js
const cron = require('node-cron');
const { saveStats, saveGeoStats, savePostViews, saveGeoPostStats } = require('../services/statsService');


// Ejecutar el job cada 5 minutos
cron.schedule('0 */5 * * * *', async () => {
  console.log('⏲️  Running statistics job');
  await saveStats();
  await savePostViews();
  await saveGeoStats();
  await saveGeoPostStats();
});