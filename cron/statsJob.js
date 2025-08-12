// ./cron/statsJob.js
const cron = require('node-cron');
const { saveStats, saveGeoStats, savePostViews } = require('../services/statsService');


// Ejecutar el job cada 10 segundos
cron.schedule('*/10 * * * * *', async () => {
  console.log('⏲️  Running statistics job');
  await saveStats();
  await savePostViews();
  await saveGeoStats();
});