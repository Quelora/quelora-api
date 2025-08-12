// ./services/statsService.js
const { cacheClient } = require('./cacheService');
const Stats = require('../models/Stats');
const GeoStats = require('../models/GeoStats');
const Post = require('../models/Post');

const saveGeoStats = async () => {
  const actions = ['like', 'share', 'comment', 'reply', 'hit'];
  for (const action of actions) {
    const geoKeys = await cacheClient.hGetAll(`geo:activity:${action}`);
   
    for (const [geoKey, count] of Object.entries(geoKeys)) {

      const parts = geoKey.replace(/^geo:/, '').split(':');
      const [cid, ip, country, countryCode, region, regionCode, city, lat, lon] = parts;

      await GeoStats.create({
        cid,
        action,
        ip: ip || 'unknown',
        country: country || 'unknown',
        countryCode: countryCode || 'unknown',
        region: region || 'unknown',
        regionCode: regionCode || 'unknown',
        city: city || 'unknown',
        latitude: lat ? parseFloat(lat) : null,
        longitude: lon ? parseFloat(lon) : null,
        count: parseInt(count),
        timestamp: new Date()
      });
    }
    await cacheClient.del(`geo:activity:${action}`);
  }
  console.log(`✅ 🌎 Successfully Geo processed`);
}

const saveStats = async () => {
  try {
    const allActivityKeys = await cacheClient.keys('activity:*');
    const activitiesByCid = {};
    
    for (const key of allActivityKeys) {
      const parts = key.split(':');
      if (parts.length === 3) { 
        const type = parts[1];
        const cid = parts[2];
        
        if (!activitiesByCid[cid]) {
          activitiesByCid[cid] = { types: new Set() };
        }
        activitiesByCid[cid].types.add(type);
      }
    }

    const cids = Object.keys(activitiesByCid);

    for (const cid of cids) {
      const likesAdded = await cacheClient.hGet(`activity:likes:${cid}`, 'added') || 0;
      const likesRemoved = await cacheClient.hGet(`activity:likes:${cid}`, 'removed') || 0;
      const sharesAdded = await cacheClient.hGet(`activity:shares:${cid}`, 'added') || 0;
      const commentsAdded = await cacheClient.hGet(`activity:comments:${cid}`, 'added') || 0;
      const repliesAdded = await cacheClient.hGet(`activity:replies:${cid}`, 'added') || 0;

      const statsData = {
        likesAdded: parseInt(likesAdded, 10),
        likesRemoved: parseInt(likesRemoved, 10),
        sharesAdded: parseInt(sharesAdded, 10),
        commentsAdded: parseInt(commentsAdded, 10),
        repliesAdded: parseInt(repliesAdded, 10)
      };

      if (Object.values(statsData).some(val => val > 0)) {
        const stats = new Stats({
          cid,
          ...statsData,
          timestamp: new Date()
        });
        await stats.save();
      }

      const types = activitiesByCid[cid].types;
      for (const type of types) {
        await cacheClient.del(`activity:${type}:${cid}`);
      }
    }
    console.log(`✅ 📊 Successfully processed ${cids.length} CIDs`);
  } catch (error) {
    console.error('❌ Error saving stats:', error);
    throw error;
  }
};

const savePostViews = async () => {
  try {
    const allViewKeys = await cacheClient.keys('cid:*:postViews:*');
    const viewsByCid = {};

    // Organizar vistas por cid y entity
    for (const key of allViewKeys) {
      const parts = key.split(':');
      if (parts.length === 4 && parts[2] === 'postViews') {
        const cid = parts[1];
        const entity = parts[3];

        if (!viewsByCid[cid]) {
          viewsByCid[cid] = {};
        }
        viewsByCid[cid][entity] = await cacheClient.get(key);
      }
    }

    const cids = Object.keys(viewsByCid);

    for (const cid of cids) {
      const views = viewsByCid[cid];

      for (const entity of Object.keys(views)) {
        const viewCount = parseInt(views[entity], 10) || 0;
        if (viewCount > 0) {
          await Post.findOneAndUpdate(
            { entity, cid, 'deletion.status': 'active' },
            { $inc: { viewsCount: viewCount } },
            { new: true }
          );
          await cacheClient.del(`cid:${cid}:postViews:${entity}`);
        }
      }
    }

    console.log(`✅ 📊 Successfully processed ${cids.length} CIDs for post views`);
  } catch (error) {
    console.error('❌ Error saving post views:', error);
    throw error;
  }
};

module.exports = { saveStats, saveGeoStats, savePostViews };