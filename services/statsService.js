// ./services/statsService.js
const { cacheClient } = require('./cacheService');
const Stats = require('../models/Stats');
const GeoStats = require('../models/GeoStats');
const GeoPostStats = require('../models/GeoPostStats');
const PostStats = require('../models/PostStats');
const Post = require('../models/Post');
const mongoose = require('mongoose');

const parseGeoKey = (geoKey) => {
    // Expected structures:
    // General (10 parts): [cid]:general:[ip]:[country]...
    // Post (11 parts):    [cid]:entity:[Entity ID]:[ip]:[country]...
    const parts = geoKey.split(':');
    
    // Check for general (10 parts)
    if (parts.length === 10 && parts[1] === 'general') {
        return {
            cid: parts[0],
            keyIdentifier: parts[1],
            ip: parts[2],
            country: parts[3],
            countryCode: parts[4],
            region: parts[5],
            regionCode: parts[6],
            city: parts[7],
            lat: parts[8],
            lon: parts[9],
            isPostKey: false
        };
    } 
    
    // Check for post (11 parts)
    if (parts.length === 11 && parts[1] === 'entity') {
        // Recombine 'entity' and '[Entity ID]' into a single keyIdentifier
        const keyIdentifier = `${parts[1]}:${parts[2]}`;
        return {
            cid: parts[0],
            keyIdentifier: keyIdentifier,
            ip: parts[3], // Shifted by one position
            country: parts[4],
            countryCode: parts[5],
            region: parts[6],
            regionCode: parts[7],
            city: parts[8],
            lat: parts[9],
            lon: parts[10],
            isPostKey: true
        };
    }
    
    // console.log(`[DEBUG_GEO] ❌ Parse Failed: Key has ${parts.length} parts (Invalid structure): ${geoKey}`);
    return null; 
};

const saveGeoStats = async () => {
    try {
        const actions = ['like', 'share', 'comment', 'reply', 'hit'];
        let processedCount = 0;

        for (const action of actions) {
            const allKeys = await cacheClient.hGetAll(`geo:activity:${action}`);
            // console.log(`[DEBUG_GEO] Processing GeoStats (General) for action '${action}'. Total keys in hash: ${Object.keys(allKeys).length}`);
            
            for (const [geoKey, count] of Object.entries(allKeys)) {
                
                // Paso 1: Filtrar solo claves generales
                if (geoKey.includes(':entity:')) continue;

                const parsedData = parseGeoKey(geoKey);
                
                if (!parsedData || parsedData.isPostKey) {
                    continue; 
                }
                
                const parsedCount = parseInt(count);

                await GeoStats.create({
                    cid: parsedData.cid,
                    action,
                    ip: parsedData.ip || 'unknown',
                    country: parsedData.country || 'unknown',
                    countryCode: parsedData.countryCode || 'unknown',
                    region: parsedData.region || 'unknown',
                    regionCode: parsedData.regionCode || 'unknown',
                    city: parsedData.city || 'unknown',
                    latitude: parsedData.lat ? parseFloat(parsedData.lat) : null,
                    longitude: parsedData.lon ? parseFloat(parsedData.lon) : null,
                    count: parsedCount,
                    timestamp: new Date()
                });
                
                // ⚠️ CORRECCIÓN: Borrar solo la clave de hash procesada
                await cacheClient.hDel(`geo:activity:${action}`, geoKey);
                processedCount++;
            }
        }
        console.log(`✅ 🌎 GeoStats (General) processed: ${processedCount} hits.`);
    } catch (error) {
        console.error('❌ Error saving system geo stats:', error);
        throw error;
    }
};

const saveGeoPostStats = async () => {
    try {
        const actions = ['like', 'share', 'comment', 'reply'];
        let processedCount = 0;

        for (const action of actions) {
            const allKeys = await cacheClient.hGetAll(`geo:activity:${action}`);
            // console.log(`[DEBUG_GEO] Processing GeoPostStats for action '${action}'. Total keys in hash: ${Object.keys(allKeys).length}`);
            
            for (const [geoKey, count] of Object.entries(allKeys)) {
                
                // Paso 1: Filtrar solo claves de post
                if (!geoKey.includes(':entity:')) continue;

                const parsedData = parseGeoKey(geoKey);
                
                if (!parsedData || !parsedData.isPostKey) {
                    continue;
                }
                
                const entityIdString = parsedData.keyIdentifier.substring('entity:'.length);
                if (!mongoose.Types.ObjectId.isValid(entityIdString)) continue;

                const parsedCount = parseInt(count);

                await GeoPostStats.create({
                    cid: parsedData.cid,
                    entity: new mongoose.Types.ObjectId(entityIdString),
                    action,
                    ip: parsedData.ip || 'unknown',
                    country: parsedData.country || 'unknown',
                    countryCode: parsedData.countryCode || 'unknown',
                    region: parsedData.region || 'unknown',
                    regionCode: parsedData.regionCode || 'unknown',
                    city: parsedData.city || 'unknown',
                    latitude: parsedData.lat ? parseFloat(parsedData.lat) : null,
                    longitude: parsedData.lon ? parseFloat(parsedData.lon) : null,
                    count: parsedCount,
                    timestamp: new Date()
                });
                
                // ⚠️ CORRECCIÓN: Borrar solo la clave de hash procesada
                await cacheClient.hDel(`geo:activity:${action}`, geoKey);
                processedCount++;
            }
        }
        console.log(`✅ 🌎 GeoPostStats processed: ${processedCount} hits.`);
    } catch (error) {
        console.error('❌ Error saving post geo stats:', error);
        throw error;
    }
};

const saveStats = async () => {
  try {
    const allActivityKeys = await cacheClient.keys('activity:*');
    const systemStats = {};
    const postStats = {};
    
    for (const key of allActivityKeys) {
      const parts = key.split(':');
      const type = parts[1];
      const cid = parts[2];
      
      if (parts.length === 3) {
        if (!systemStats[cid]) systemStats[cid] = { types: new Set() };
        systemStats[cid].types.add(type);
      } else if (parts.length === 4) {
        const entityId = parts[3];
        if (!postStats[cid]) postStats[cid] = {};
        if (!postStats[cid][entityId]) postStats[cid][entityId] = { types: new Set() };
        postStats[cid][entityId].types.add(type);
      }
    }

    const timestamp = new Date();

    let processedPostEntities = 0;
    for (const cid of Object.keys(postStats)) {
      for (const entity of Object.keys(postStats[cid])) {
        if (!mongoose.Types.ObjectId.isValid(entity)) continue; 

        const likesAdded = await cacheClient.hGet(`activity:likes:${cid}:${entity}`, 'added') || 0;
        const likesRemoved = await cacheClient.hGet(`activity:likes:${cid}:${entity}`, 'removed') || 0;
        const sharesAdded = await cacheClient.hGet(`activity:shares:${cid}:${entity}`, 'added') || 0;
        const commentsAdded = await cacheClient.hGet(`activity:comments:${cid}:${entity}`, 'added') || 0;
        const repliesAdded = await cacheClient.hGet(`activity:replies:${cid}:${entity}`, 'added') || 0;

        const statsData = {
          likesAdded: parseInt(likesAdded, 10),
          likesRemoved: parseInt(likesRemoved, 10),
          sharesAdded: parseInt(sharesAdded, 10),
          commentsAdded: parseInt(commentsAdded, 10),
          repliesAdded: parseInt(repliesAdded, 10)
        };

        if (Object.values(statsData).some(val => val > 0)) {
          const stats = new PostStats({
            cid,
            entity: new mongoose.Types.ObjectId(entity),
            ...statsData,
            timestamp
          });
          await stats.save();
          processedPostEntities++;
        }

        const types = postStats[cid][entity].types;
        for (const type of types) {
          await cacheClient.del(`activity:${type}:${cid}:${entity}`);
        }
      }
    }
    
    const cids = Object.keys(systemStats);
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
          timestamp
        });
        await stats.save();
      }

      const types = systemStats[cid].types;
      for (const type of types) {
        await cacheClient.del(`activity:${type}:${cid}`);
      }
    }
    console.log(`✅ 📊 Successfully processed ${cids.length} CIDs (System) and ${processedPostEntities} Post Entities`);
  } catch (error) {
    console.error('❌ Error saving stats:', error);
    throw error;
  }
};

const savePostViews = async () => {
  try {
    const allViewKeys = await cacheClient.keys('cid:*:postViews:*');
    const viewsByCid = {};

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

module.exports = { saveStats, saveGeoStats, saveGeoPostStats, savePostViews };