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
    // Post (11 parts):    [cid]:entity:[Entity ID]:[ip]:[country]...
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
    
    return null; 
};

// --- Nuevas funciones para procesar estadísticas con marca de tiempo ---

const createDateFromYYYYMMDDHHmm = (yyyymmddhhmm) => {
    if (yyyymmddhhmm.length !== 12) return new Date();
    const year = parseInt(yyyymmddhhmm.substring(0, 4), 10);
    const month = parseInt(yyyymmddhhmm.substring(4, 6), 10) - 1; // Meses son 0-indexados
    const day = parseInt(yyyymmddhhmm.substring(6, 8), 10);
    const hour = parseInt(yyyymmddhhmm.substring(8, 10), 10);
    const minute = parseInt(yyyymmddhhmm.substring(10, 12), 10);
    
    // Crear la fecha en UTC (esto es crucial para la consistencia)
    return new Date(Date.UTC(year, month, day, hour, minute));
};

const saveTimeStampedGeoStats = async (action, geoKeyPrefix) => {
    let processedCount = 0;
    // La clave ahora termina en YYYYMMDDHHmm (12 dígitos)
    const allTimestampKeys = await cacheClient.keys(`${geoKeyPrefix}:${action}:????????????`);

    for (const fullKey of allTimestampKeys) {
        const parts = fullKey.split(':');
        // El timestamp YYYYMMDDHHmm es el último segmento
        const yyyymmddhhmm = parts[parts.length - 1];
        const timestamp = createDateFromYYYYMMDDHHmm(yyyymmddhhmm);
        
        const allHits = await cacheClient.hGetAll(fullKey);

        for (const [geoKey, count] of Object.entries(allHits)) {
            const parsedData = parseGeoKey(geoKey);
            if (!parsedData) continue;
            
            const isPostKey = parsedData.keyIdentifier.startsWith('entity:');
            const parsedCount = parseInt(count);

            const statData = {
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
                timestamp
            };
            
            if (isPostKey) {
                 const entityIdString = parsedData.keyIdentifier.substring('entity:'.length);
                 if (!mongoose.Types.ObjectId.isValid(entityIdString)) continue;
                 await GeoPostStats.create({ ...statData, entity: new mongoose.Types.ObjectId(entityIdString) });
            } else {
                 await GeoStats.create(statData);
            }
            
            await cacheClient.hDel(fullKey, geoKey);
            processedCount++;
        }
        // Si el hash está vacío después de procesar, borrar la clave completa
        const remainingKeys = await cacheClient.hGetAll(fullKey);
        if (Object.keys(remainingKeys).length === 0) {
             await cacheClient.del(fullKey);
        }
    }
    return processedCount;
};

const saveTimeStampedStats = async (keyPrefix) => {
    let processedEntities = 0;
    // Las claves ahora terminan en YYYYMMDDHHmm (12 dígitos)
    const allTimestampKeys = await cacheClient.keys(`${keyPrefix}:*????????????`); 

    for (const fullKey of allTimestampKeys) {
        const parts = fullKey.split(':');
        // Clave de Post: activity:timestamp:type:cid:entityId:YYYYMMDDHHmm (6 partes)
        // Clave General: activity:timestamp:type:cid:YYYYMMDDHHmm (5 partes)
        const isPostKey = parts.length === 6; 
        
        const type = parts[2];
        const cid = parts[3];
        const dateIndex = isPostKey ? 5 : 4;
        const yyyymmddhhmm = parts[dateIndex];
        
        const timestamp = createDateFromYYYYMMDDHHmm(yyyymmddhhmm);
        
        const allActions = await cacheClient.hGetAll(fullKey);
        
        // Asumiendo que solo se registra 'added' y 'removed' en el hash
        const added = parseInt(allActions['added'] || 0, 10);
        const removed = parseInt(allActions['removed'] || 0, 10);
        
        const statsData = {
            likesAdded: type === 'likes' ? added : 0,
            likesRemoved: type === 'likes' ? removed : 0,
            sharesAdded: type === 'shares' ? added : 0,
            commentsAdded: type === 'comments' ? added : 0,
            repliesAdded: type === 'replies' ? added : 0,
        };
        
        if (Object.values(statsData).some(val => val > 0)) {
            if (isPostKey) {
                const entity = parts[4];
                if (!mongoose.Types.ObjectId.isValid(entity)) continue; 
                await PostStats.create({
                    cid,
                    entity: new mongoose.Types.ObjectId(entity),
                    ...statsData,
                    timestamp
                });
            } else {
                await Stats.create({
                    cid,
                    ...statsData,
                    timestamp
                });
            }
            processedEntities++;
        }
        await cacheClient.del(fullKey);
    }
    return processedEntities;
};

// --- Funciones originales modificadas para incluir el procesamiento de timestamps ---

const saveGeoStats = async () => {
    try {
        const actions = ['like', 'share', 'comment', 'reply', 'hit'];
        let processedCount = 0;

        for (const action of actions) {
            const allKeys = await cacheClient.hGetAll(`geo:activity:${action}`);
            
            for (const [geoKey, count] of Object.entries(allKeys)) {
                
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
                
                await cacheClient.hDel(`geo:activity:${action}`, geoKey);
                processedCount++;
            }
        }
        
        // PROCESAR ESTADÍSTICAS GEOGRÁFICAS CON MARCA DE TIEMPO
        const timestampedGeoCount = 
            await saveTimeStampedGeoStats('like', 'geo:activity:timestamp') +
            await saveTimeStampedGeoStats('share', 'geo:activity:timestamp') +
            await saveTimeStampedGeoStats('comment', 'geo:activity:timestamp') +
            await saveTimeStampedGeoStats('reply', 'geo:activity:timestamp') +
            await saveTimeStampedGeoStats('hit', 'geo:activity:timestamp');
        
        console.log(`✅ 🌎 GeoStats (General) processed: ${processedCount} real-time hits, ${timestampedGeoCount} timestamped hits.`);
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
            
            for (const [geoKey, count] of Object.entries(allKeys)) {
                
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
                
                await cacheClient.hDel(`geo:activity:${action}`, geoKey);
                processedCount++;
            }
        }
        
        // PROCESAR ESTADÍSTICAS GEOGRÁFICAS DE POSTS CON MARCA DE TIEMPO
        // La función saveTimeStampedGeoStats procesa tanto generales como de post, 
        // ya que la diferenciación está en la clave de hash (geoKey).
        const timestampedGeoPostCount = 
            await saveTimeStampedGeoStats('like', 'geo:activity:timestamp') +
            await saveTimeStampedGeoStats('share', 'geo:activity:timestamp') +
            await saveTimeStampedGeoStats('comment', 'geo:activity:timestamp') +
            await saveTimeStampedGeoStats('reply', 'geo:activity:timestamp');
        
        console.log(`✅ 🌎 GeoPostStats processed: ${processedCount} real-time hits, ${timestampedGeoPostCount} timestamped hits.`);
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
            
            // Ignorar las claves de timestamp
            if (parts[1] === 'timestamp') continue; 
            
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

        // PROCESAR ESTADÍSTICAS DESAGREGADAS (POSTS)
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
        
        // PROCESAR ESTADÍSTICAS AGREGADAS (SISTEMA)
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
        
        // PROCESAR ESTADÍSTICAS CON MARCA DE TIEMPO
        const timestampedCount = 
            await saveTimeStampedStats('activity:timestamp:likes') +
            await saveTimeStampedStats('activity:timestamp:shares') +
            await saveTimeStampedStats('activity:timestamp:comments') +
            await saveTimeStampedStats('activity:timestamp:replies');
        
        console.log(`✅ 📊 Successfully processed ${cids.length} CIDs (System), ${processedPostEntities} Post Entities (real-time), and ${timestampedCount} Post/System Entities (timestamped)`);
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