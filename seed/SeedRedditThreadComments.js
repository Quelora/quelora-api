// USO: CID="QU-ME7HF2BN-E8QD9" REDDIT_URL="..." node SeedRedditThreadComments.js
// SeedRedditThreadComments.js - Versión 2.20 (FINAL: Elimina 'hit', Registra Comments/Replies/Likes Agregados y Desagregados)

require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const connectDB = require('../db');
const Profile = require('../models/Profile');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const ProfileComment = require('../models/ProfileComment');
const ProfileLike = require('../models/ProfileLike');
const crypto = require('crypto');
const axios = require('axios');
const cheerio = require('cheerio');
const { recordGeoActivity, recordActivityHit } = require('../utils/recordStatsActivity'); 

const { CITIES } = require('./config/geoData');

const REDDIT_THREAD_ENTITY  = process.env.REDDIT_ENTITY;
const REDDIT_THREAD_URL = process.env.REDDIT_URL;
const REDDIT_LIMIT = process.env.REDDIT_LIMIT || 1000;
const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID;
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET;

const uniqueAuthors = new Set();
const usedValidNames = new Set();
const authorToNameMap = new Map();

const profileUpdatesMap = new Map(); 
const TIMEOUT_MS = 25000;
const MORE_COMMENTS_BATCH_SIZE = 100;

let accessToken = null;
let US_CITIES_FILTERED = null;

async function getRedditAccessToken() {
    try {
        const auth = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64');
        const response = await axios.post('https://www.reddit.com/api/v1/access_token', 'grant_type=client_credentials', {
            headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Quelora-Seeder/2.20' },
            timeout: 10000
        });
        accessToken = response.data.access_token;
        return accessToken;
    } catch (error) {
        throw error;
    }
}

async function makeAuthenticatedRedditRequest(url, method = 'get', data = null) {
    if (!accessToken) await getRedditAccessToken();
    try {
        const config = { method, url, headers: { 'Authorization': `Bearer ${accessToken}`, 'User-Agent': 'Quelora-Seeder/2.20' }, timeout: TIMEOUT_MS };
        if (method === 'post') {
            config.data = data;
            config.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }
        return (await axios(config)).data;
    } catch (error) {
        if (error.response?.status === 401) {
            await getRedditAccessToken();
            return makeAuthenticatedRedditRequest(url, method, data);
        }
        throw error;
    }
}

const generateRandomCoords = (baseCoords) => {
    const [lon, lat] = baseCoords;
    const latOffset = (Math.random() - 0.5) * 0.2;
    const lonOffset = (Math.random() - 0.5) * 0.2;
    return [parseFloat((lon + lonOffset).toFixed(6)), parseFloat((lat + latOffset).toFixed(6))];
};

const generateAuthorHash = (name) => crypto.createHash('sha256').update(name).digest('hex');

const generateValidName = (redditUsername) => {
    const cleanName = redditUsername.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    let validName = cleanName.substring(0, 15);
    if (validName.length < 3) validName = 'rdt' + Math.random().toString(36).substring(2, 5);
    let counter = 0;
    while (true) {
        const suffix = counter === 0 ? '' : counter.toString();
        const finalName = validName.substring(0, 15 - suffix.length) + suffix;
        if (finalName.length < 3) {
            validName = 'rdt' + Math.random().toString(36).substring(2, 12);
            counter = 0;
            continue;
        }
        if (!usedValidNames.has(finalName)) {
            usedValidNames.add(finalName);
            return finalName;
        }
        counter++;
        if (counter > 100) throw new Error(`Name generation failed for ${redditUsername}`);
    }
};

function accumulateProfileChanges(profileId, changes) {
    const current = profileUpdatesMap.get(profileId.toString()) || { comments: 0, likes: 0 };
    profileUpdatesMap.set(profileId.toString(), {
        comments: current.comments + (changes.comments || 0),
        likes: current.likes + (changes.likes || 0)
    });
}

async function bulkUpdateProfileCounters() {
    if (profileUpdatesMap.size === 0) return;

    console.log(`⏳ Iniciando actualización en lote para ${profileUpdatesMap.size} perfiles...`);
    const bulkOps = [];
    
    for (const [profileId, changes] of profileUpdatesMap.entries()) {
        const update = {};
        if (changes.comments > 0) update.commentsCount = changes.comments;
        if (changes.likes > 0) update.likesCount = changes.likes;

        if (Object.keys(update).length > 0) {
            bulkOps.push({
                updateOne: {
                    filter: { _id: profileId },
                    update: { $inc: update, $set: { updated_at: new Date() } }
                }
            });
        }
    }

    if (bulkOps.length > 0) {
        try {
            const result = await Profile.bulkWrite(bulkOps);
            console.log(`✅ Actualización en lote completada: ${result.modifiedCount} perfiles actualizados.`);
        } catch (error) {
            console.error(`❌ Error en la actualización en lote de contadores:`, error.message);
        }
    }
}

function simulateRequestFromProfile(profile) {
    const geo = profile.location;

    if (!profile || !geo || !profile.cid || !geo.coordinates || geo.coordinates.length < 2) {
        const cid = profile?.cid || process.env.CID || 'N/A';
        return null;
    }

    const clientIp = profile.simulatedIp || `192.0.2.${Math.floor(Math.random() * 255)}`;

    return {
        cid: profile.cid,
        clientIp: clientIp,
        clientCountry: geo.country || '',
        clientCountryCode: geo.countryCode || '',
        clientRegion: geo.region || '',
        clientRegionCode: geo.regionCode || '',
        clientCity: geo.city || '',
        clientLatitude: geo.coordinates[1],
        clientLongitude: geo.coordinates[0],
        geoData: null
    };
}

function findRedditThreadId(url) {
    const threadMatch = url.match(/comments\/([a-z0-9]+)/i);
    if (!threadMatch || !threadMatch[1]) {
        return null;
    }
    return threadMatch[1];
}

async function getOrCreateProfile(redditAuthor) {
    if (authorToNameMap.has(redditAuthor)) {
        const validName = authorToNameMap.get(redditAuthor);
        const existingProfile = await Profile.findOne({ name: validName }).maxTimeMS(TIMEOUT_MS);
        if (existingProfile) return existingProfile;
    }

    const validName = generateValidName(redditAuthor);
    const existingProfile = await Profile.findOne({ name: validName }).maxTimeMS(TIMEOUT_MS);
    if (existingProfile) {
        authorToNameMap.set(redditAuthor, validName);
        return existingProfile;
    }

    uniqueAuthors.add(redditAuthor);
    authorToNameMap.set(redditAuthor, validName);
    
    if (!US_CITIES_FILTERED) {
        US_CITIES_FILTERED = CITIES.filter(city => city.countryCode === 'US');
        if (US_CITIES_FILTERED.length === 0) {
            console.error('❌ No hay ciudades de US en CITIES config. Usando la lista completa.');
            US_CITIES_FILTERED = CITIES;
        }
    }

    const cityData = US_CITIES_FILTERED[Math.floor(Math.random() * US_CITIES_FILTERED.length)];
    const coordinates = generateRandomCoords(cityData.coords);

    const profileData = {
        cid: process.env.CID || 'QU-ME7HF2BN-E8QD9',
        author: generateAuthorHash(validName),
        name: validName,
        given_name: redditAuthor,
        family_name: 'Reddit',
        locale: 'en',
        email: `${validName}@reddit.quelora.com`,
        picture: `https://i.pravatar.cc/150?img=${Math.floor(Math.random() * 70) + 1}`,
        bookmarksCount: 0, commentsCount: 0, followersCount: 0, followingCount: 0,
        blockedCount: 0, likesCount: 0, sharesCount: 0,
        location: {
            type: 'Point',
            coordinates: coordinates,
            city: cityData.name,
            country: cityData.country,             
            countryCode: cityData.countryCode,
            region: cityData.region,               
            regionCode: cityData.regionCode,
            lastUpdated: new Date(),
            source: 'geocoding'
        },
        simulatedIp: cityData.ip,
        settings: {
            notifications: { web: true, email: true, push: true, newFollowers: true, postLikes: true, comments: true, newPost: true },
            privacy: { followerApproval: false, showActivity: 'everyone' },
            interface: { defaultLanguage: 'en', defaultTheme: 'system' },
            session: { rememberSession: true }
        },
    };

    try {
        const profile = new Profile(profileData);
        await profile.save();
        console.log(`✅ Perfil creado: ${validName} en ${cityData.name}, ${cityData.countryCode} (${cityData.ip})`);
        // Aseguramos que el objeto retornado tenga el IP simulado para GeoStats
        profile._doc.simulatedIp = cityData.ip; 
        return profile;
    } catch (error) {
        console.error(`❌ Error creando perfil para ${redditAuthor}:`, error.message);
        return null;
    }
}

async function fetchRedditData(threadUrl, limit = 1000) {
    const threadId = findRedditThreadId(threadUrl);
    if (!threadId) {
        throw new Error(`❌ URL de Reddit inválida. No se encontró el ID del hilo en: ${threadUrl}`);
    }

    const subreddit = threadUrl.split('/r/')[1].split('/')[0];
    const apiUrl = `https://oauth.reddit.com/r/${subreddit}/comments/${threadId}.json?limit=${limit}&threaded=true&sort=top`;
    console.log(`📡 Obteniendo datos de comentarios de: ${apiUrl}`);
    const [postData, commentsData] = await makeAuthenticatedRedditRequest(apiUrl);
    
    const post = postData.data.children[0].data;
    
    return {
        post: {
            title: post.title,
            upvotes: post.ups,
            comments: post.num_comments,
            created: post.created_utc, 
        },
        comments: commentsData.data.children.filter(c => c.kind === 't1'),
        moreComments: commentsData.data.children.filter(c => c.kind === 'more').flatMap(more => more.data.children)
    };
}

async function fetchMoreComments(threadId, childrenIds) {
    try {
        console.log(`📡 Obteniendo lote de ${childrenIds.length} comentarios adicionales...`);
        const data = new URLSearchParams({ api_type: 'json', children: childrenIds.join(','), link_id: `t3_${threadId}`, sort: 'top' });
        const response = await makeAuthenticatedRedditRequest(`https://oauth.reddit.com/api/morechildren`, 'post', data);
        return response.json?.data?.things || [];
    } catch (error) {
        console.error('❌ Error obteniendo "more" comments:', error.message);
        return [];
    }
}

async function createOrFindPost(redditData, entityId, moreComments) {
    let post = await Post.findOne({ entity: entityId }).maxTimeMS(TIMEOUT_MS);
    if (!post) {
        throw new Error(`❌ Post con entity ${entityId} no encontrado. Ejecute SeedRedditThread.js primero.`);
    }

    console.log(`✅ Post existente encontrado: ${post._id}`);
    if (post.moreCommentsRef.length === 0 && moreComments.length > 0) {
        post.moreCommentsRef = moreComments;
        await post.save();
    }
    return post;
}

// Función auxiliar para obtener el perfil de un autor rápidamente desde el Map de perfiles existentes
function getProfileByAuthor(authorId, allProfilesMap) {
    return allProfilesMap.get(authorId.toString());
}

async function processCommentsRecursively(commentsData, postId, entityId, allProfiles, allProfilesMap, parentId = null) {
    let createdCommentsCount = 0;
    const newMoreCommentIds = [];
    const cid = process.env.CID;

    for (const item of commentsData) {
        if (item.kind === 't1' && item.data.author && item.data.body && !['[deleted]', '[removed]'].includes(item.data.body)) {
            const commentData = item.data;
            if (await Comment.findOne({ reference: commentData.name }).select('_id').lean()) {
                continue;
            }
            try {
                // Si el perfil no existe, lo crea
                const profile = await getOrCreateProfile(commentData.author);
                if (!profile) continue;

                const likesCount = Math.max(0, commentData.ups || 0);
                const newComment = new Comment({
                    post: postId, entity: entityId, parent: parentId,
                    profile_id: profile._id, author: profile.author,
                    reference: commentData.name, text: commentData.body,
                    likesCount: likesCount, created_at: new Date(commentData.created_utc * 1000)
                });
                await newComment.save();
                createdCommentsCount++;
                console.log(`✅ Comentario creado: ${commentData.author} - "${commentData.body.substring(0, 30)}..."`); 
                
                await new ProfileComment({ profile_id: profile._id, post_id: postId, comment_id: newComment._id }).save();
                accumulateProfileChanges(profile._id, { comments: 1 });

                const action = parentId ? 'reply' : 'comment';
                const activityType = parentId ? 'replies' : 'comments';
                const simulatedReq = simulateRequestFromProfile(profile.toObject()); 
                
                if (simulatedReq) {
                    // --- REGISTRO DE ESTADÍSTICAS DEL COMENTARIO/RESPUESTA ---
                    
                    // 1. Registro PUNTUAL DESAGREGADO (PostStats)
                    await recordActivityHit(`activity:${activityType}:${cid}`, 'added', entityId);
                    // 2. Registro PUNTUAL AGREGADO (Stats)
                    await recordActivityHit(`activity:${activityType}:${cid}`, 'added');
                    
                    // 3. Registro GEOGRÁFICO DESAGREGADO (GeoPostStats)
                    await recordGeoActivity(simulatedReq, action, entityId); 
                    // 4. Registro GEOGRÁFICO AGREGADO (GeoStats)
                    await recordGeoActivity(simulatedReq, action);
                }

                if (likesCount > 0 && allProfiles.length > 0) {
                    const likerPool = allProfiles.filter(p => p._id.toString() !== profile._id.toString());
                    if (likerPool.length > 0) {
                        const shuffledLikerPool = likerPool.sort(() => 0.5 - Math.random());
                        const numLikesToCreate = Math.min(likesCount, shuffledLikerPool.length);
                        const selectedLikers = shuffledLikerPool.slice(0, numLikesToCreate); 
                        
                        const profileLikeDocs = selectedLikers.map(liker => ({ 
                            profile_id: liker._id, fk_id: newComment._id, fk_type: 'comment' 
                        }));
                        
                        if (profileLikeDocs.length > 0) {
                            await ProfileLike.insertMany(profileLikeDocs);
                            console.log(`❤️     ${profileLikeDocs.length} likes simulados para el comentario ${newComment._id}`);
                            
                            // --- REGISTRO DE ESTADÍSTICAS DEL LIKE (COMENTARIO) ---
                            
                            // 1. Registro PUNTUAL DESAGREGADO (PostStats)
                            await recordActivityHit(`activity:likes:${cid}`, 'added', entityId);
                            // 2. Registro PUNTUAL AGREGADO (Stats)
                            await recordActivityHit(`activity:likes:${cid}`, 'added');

                            for (const liker of selectedLikers) {
                                const likerReq = simulateRequestFromProfile(liker);
                                if (likerReq) {
                                    // 3. Registro GEOGRÁFICO DESAGREGADO (GeoPostStats)
                                    await recordGeoActivity(likerReq, 'like', entityId);
                                    // 4. Registro GEOGRÁFICO AGREGADO (GeoStats)
                                    await recordGeoActivity(likerReq, 'like');
                                }
                                accumulateProfileChanges(liker._id, { likes: 1 });
                            }
                            
                            const likerAuthors = selectedLikers.map(l => l.author);
                            await Comment.findByIdAndUpdate(newComment._id, {
                                $push: { likes: { $each: likerAuthors, $slice: -200 } }
                            });
                        }
                    }
                }

                if (parentId) await Comment.findByIdAndUpdate(parentId, { $inc: { repliesCount: 1 } });
                
                if (commentData.replies?.data?.children.length > 0) {
                    const { count, moreIds } = await processCommentsRecursively(commentData.replies.data.children, postId, entityId, allProfiles, allProfilesMap, newComment._id);
                    createdCommentsCount += count;
                    newMoreCommentIds.push(...moreIds);
                }
            } catch (error) {
                console.error(`❌ Error procesando comentario de ${commentData.author}:`, error.message);
            }
        } else if (item.kind === 'more') {
            newMoreCommentIds.push(...item.data.children);
        }
    }
    return { count: createdCommentsCount, moreIds: newMoreCommentIds };
}

async function seedRedditThread() {
    let exitCode = 0;
    try {
        if (!REDDIT_THREAD_URL || !REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET || !REDDIT_THREAD_ENTITY) {
            throw new Error('❌ Variables de entorno (REDDIT_URL, CREDENCIALES, REDDIT_ENTITY) son requeridas.');
        }

        await connectDB();
        console.log('✅ Conexión a DB establecida');
        
        console.log('👤 Obteniendo IDs, Autores, CID y Ubicación de perfiles para simulación (Carga única)...');
        // CARGA ÚNICA DE TODOS LOS PERFILES PARA EVITAR CONSULTAS EN EL BUCLE RECURSIVO
        const allProfiles = await Profile.find({}, '_id author cid location simulatedIp').lean(); 
        console.log(`👍 Encontrados ${allProfiles.length} perfiles para usar como votantes.`);

        const allProfilesMap = new Map(allProfiles.map(p => [p._id.toString(), p]));
        
        const entityId = REDDIT_THREAD_ENTITY;
        
        const threadId = findRedditThreadId(REDDIT_THREAD_URL);
        if (!threadId) {
            console.error(`❌ El valor de REDDIT_URL ('${REDDIT_THREAD_URL}') no es un permalink válido de Reddit.`);
            throw new Error('URL de Reddit inválida. Debe ser un permalink de Reddit.');
        }

        const redditData = await fetchRedditData(REDDIT_THREAD_URL, REDDIT_LIMIT);
        
        let post = await createOrFindPost(redditData, entityId, redditData.moreComments);
        
        if (!post?.metadata?.imported_comments) {
            console.log("⏳ Realizando importación inicial de comentarios...");
            
            // PASAMOS EL ARRAY DE PERFILES Y EL MAP A LA FUNCIÓN RECURSIVA
            const { count, moreIds } = await processCommentsRecursively(redditData.comments, post._id, entityId, allProfiles, allProfilesMap, null);
            
            if (moreIds.length > 0) {
                await Post.findByIdAndUpdate(post._id, { $addToSet: { moreCommentsRef: { $each: moreIds } } });
                post.moreCommentsRef.push(...moreIds);
            }
            console.log(`✅ ${count} comentarios iniciales creados.`);
        } else {
            console.log("✅ Post encontrado. Reanudando desde comentarios pendientes...");
        }

        post.moreCommentsRef = [...new Set(post.moreCommentsRef)];

        while (post.moreCommentsRef.length > 0) {
            const idsToFetch = post.moreCommentsRef.splice(0, MORE_COMMENTS_BATCH_SIZE);
            const newCommentsData = await fetchMoreComments(threadId, idsToFetch);
            if (newCommentsData.length > 0) {
                // PASAMOS EL ARRAY DE PERFILES Y EL MAP A LA FUNCIÓN RECURSIVA
                const { moreIds } = await processCommentsRecursively(newCommentsData, post._id, entityId, allProfiles, allProfilesMap, null); 
                post.moreCommentsRef.push(...moreIds);
            }
            await Post.findByIdAndUpdate(post._id, { $set: { moreCommentsRef: post.moreCommentsRef } });
            console.log(`📊 moreCommentsRef restantes: ${post.moreCommentsRef.length}`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        await bulkUpdateProfileCounters(); 
        
        console.log('⏳ Actualizando conteo final de comentarios en el post...');
        const finalCommentCount = await Comment.countDocuments({ post: post._id });
        await Post.findByIdAndUpdate(post._id, {
            commentCount: finalCommentCount,
            updated_at: new Date(),
            'metadata.imported_comments': true
        });

        console.log('🎉 Hilo de Reddit importado/actualizado exitosamente! Las GeoStats de interacciones están registradas correctamente.');
    } catch (err) {
        console.error('❌ Error fatal en el seed:', err.message, err.stack);
        exitCode = 1;
    } finally {
        await mongoose.connection.close();
        console.log('✅ Conexión a DB cerrada. Finalizando script.');
        process.exit(exitCode);
    }
}

console.log('🚀 Iniciando seedRedditThreadComments (versión 2.20 - GeoStats solo para likes/comments/replies)...');
seedRedditThread();