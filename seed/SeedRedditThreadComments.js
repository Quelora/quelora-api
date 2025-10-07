// SeedRedditThreadComments.js - Versión 2.12 (CORRECCIÓN DE URL EXTERNA Y OBTENCIÓN DE DESCRIPCIÓN)
// USO: CID="QU-ME7HF2BN-E8QD9" REDDIT_URL="https://www.reddit.com/r/Android/comments/1nr65np/android_will_soon_run_linux_apps_better_by_adding/" REDDIT_ENTITY="QU-ME7HF2BN-E8QD9" node SeedRedditThreadComments.js

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

const REDDIT_THREAD_ENTITY  = process.env.REDDIT_ENTITY;
const REDDIT_THREAD_URL = process.env.REDDIT_URL;
const REDDIT_LIMIT = process.env.REDDIT_LIMIT || 1000;
const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID;
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET;

// Sets para optimización
const uniqueAuthors = new Set();
const usedValidNames = new Set();
const authorToNameMap = new Map();

// --- ESTRATEGIA DE BATCHING PARA CONTADORES DE PERFILES ---
const profileUpdatesMap = new Map(); 
const TIMEOUT_MS = 25000;
const MORE_COMMENTS_BATCH_SIZE = 100;
// -----------------------------------------------------------

// Datos para perfiles sintéticos (sin cambios)
const CITIES = [
    { name: "New York", coords: [-74.0060, 40.7128], country: "United States", countryCode: "US", region: "New York", regionCode: "NY" },
    { name: "Los Angeles", coords: [-118.2437, 34.0522], country: "United States", countryCode: "US", region: "California", regionCode: "CA" },
    { name: "Chicago", coords: [-87.6298, 41.8781], country: "United States", countryCode: "US", region: "Illinois", regionCode: "IL" },
    { name: "London", coords: [-0.1278, 51.5074], country: "United Kingdom", countryCode: "GB", region: "England", regionCode: "ENG" },
    { name: "Berlin", coords: [13.4050, 52.5200], country: "Germany", countryCode: "DE", region: "Berlin", regionCode: "BE" },
    { name: "Tokyo", coords: [139.6917, 35.6895], country: "Japan", countryCode: "JP", region: "Tokyo", regionCode: "TKY" }
];

let accessToken = null;

// --- FUNCIONES DE AUTENTICACIÓN Y REDDIT (sin cambios) ---
async function getRedditAccessToken() {
    try {
        console.log('🔑 Obteniendo token de acceso de Reddit...');
        const auth = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64');
        const response = await axios.post('https://www.reddit.com/api/v1/access_token', 'grant_type=client_credentials', {
            headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Quelora-Seeder/2.12' },
            timeout: 10000
        });
        accessToken = response.data.access_token;
        console.log('✅ Token de acceso obtenido exitosamente');
        return accessToken;
    } catch (error) {
        console.error('❌ Error obteniendo token de acceso:', error.response?.data || error.message);
        throw error;
    }
}

async function makeAuthenticatedRedditRequest(url, method = 'get', data = null) {
    if (!accessToken) await getRedditAccessToken();
    try {
        const config = { method, url, headers: { 'Authorization': `Bearer ${accessToken}`, 'User-Agent': 'Quelora-Seeder/2.12' }, timeout: TIMEOUT_MS };
        if (method === 'post') {
            config.data = data;
            config.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }
        return (await axios(config)).data;
    } catch (error) {
        console.error('❌ Error en solicitud a Reddit:', error.message);
        if (error.response?.status === 401) {
            console.log('🔄 Token expirado, obteniendo nuevo token...');
            await getRedditAccessToken();
            return makeAuthenticatedRedditRequest(url, method, data);
        }
        throw error;
    }
}

// --- FUNCIONES AUXILIARES (con modificación en scrapeWebpage) ---

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

const decodeHtmlEntities = (str) => str ? str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : str;


/**
 * 🆕 MODIFICACIÓN CLAVE: Intenta obtener la descripción del meta tag, o la descripción de Open Graph,
 * o el primer párrafo del cuerpo de la nota.
 */
async function scrapeWebpage(url) {
    try {
        console.log(`🌍 Intentando scrapeo de: ${url}`);
        const { data } = await axios.get(url, { headers: { 'User-Agent': 'Quelora-Seeder/2.12' }, timeout: TIMEOUT_MS });
        const $ = cheerio.load(data);
        
        // 1. Buscar descripción en meta tags (preferido)
        let description = $('meta[name="description"]').attr('content') 
                        || $('meta[property="og:description"]').attr('content') 
                        || '';
        
        // 2. Si no hay meta description, intentar obtener el primer párrafo (general)
        if (!description) {
            const firstParagraph = $('p').first().text();
            if (firstParagraph && firstParagraph.length > 50) {
                description = firstParagraph.substring(0, 300) + '...'; // Limitar a 300 caracteres
                console.log('          Descripción obtenida del primer párrafo.');
            }
        }

        // 3. Buscar imagen (sin cambios)
        let image = $('meta[property="og:image"]').attr('content') || $('article img').first().attr('src') || null;
        if (image && !image.startsWith('http')) image = new URL(image, new URL(url).origin).href;
        
        return { description: decodeHtmlEntities(description), image: decodeHtmlEntities(image) };
    } catch (error) {
        console.error(`⚠️ Error scraping ${url}: ${error.message}`);
        return { description: '', image: null };
    }
}
// ... (Funciones de actualización en lote y simulación de petición sin cambios) ...

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
        console.warn(`⚠️ Perfil incompleto para GeoStats (CID: ${cid}).`);
        return null; 
    }
    
    return {
        cid: profile.cid,
        clientIp: `192.0.2.${Math.floor(Math.random() * 255)}`, // IP simple de simulación
        
        clientCountry: geo.country || '', 
        clientCountryCode: geo.countryCode || '',
        clientRegion: geo.city || '',
        clientRegionCode: geo.regionCode || '',
        clientCity: geo.city || '',
        clientLatitude: geo.coordinates[1],
        clientLongitude: geo.coordinates[0],
        
        geoData: null 
    };
}

// --- LÓGICA PRINCIPAL DE SEEDING (Modificaciones en fetchRedditData y createOrFindPost) ---

/**
 * 🆕 MODIFICACIÓN CLAVE: Se separa la URL externa del permalink de Reddit.
 * También se utiliza el valor de post.url (que es la URL externa para Link Posts)
 * para realizar el scraping condicionalmente.
 */
async function fetchRedditData(threadUrl, limit = 1000) {
    const threadMatch = threadUrl.match(/comments\/([a-z0-9]+)/i);
    if (!threadMatch) throw new Error('URL de Reddit inválida');
    const threadId = threadMatch[1];
    const subreddit = threadUrl.split('/r/')[1].split('/')[0];
    const apiUrl = `https://oauth.reddit.com/r/${subreddit}/comments/${threadId}.json?limit=${limit}&threaded=true&sort=top`;
    console.log(`📡 Obteniendo datos iniciales de: ${apiUrl}`);
    const [postData, commentsData] = await makeAuthenticatedRedditRequest(apiUrl);
    
    const post = postData.data.children[0].data;
    
    // 1. Definir las URLs
    const redditPermalink = `https://reddit.com${post.permalink}`;
    const externalUrl = (post.is_self || !post.url || post.url.includes(redditPermalink)) ? null : post.url;
    
    let imageUrl = null;
    let description = post.selftext || ''; // Inicialmente, usa el texto del post si es un self-post

    // 2. Procesamiento de URLs (Imágenes y Scraping de Descripción/Imagen)
    if (post.preview?.images?.[0]) {
        imageUrl = decodeHtmlEntities(post.preview.images[0].source.url);
    } else if (post.url && /\.(jpg|png|gif)$/.test(post.url)) {
        imageUrl = decodeHtmlEntities(post.url);
    } else if (post.url_overridden_by_dest && /\.(jpg|png|gif)$/.test(post.url_overridden_by_dest)) {
        imageUrl = decodeHtmlEntities(post.url_overridden_by_dest);
    }

    // 3. SCRAPING para descripción si es un Link Post que no es una imagen
    if (externalUrl && !imageUrl) {
        const scrapedData = await scrapeWebpage(externalUrl);
        description = scrapedData.description || description; // Priorizar la descripción scrapeada
        if (!imageUrl) imageUrl = scrapedData.image || null;
    } else if (externalUrl && imageUrl) {
        // A veces el post de Reddit no tiene descripción, pero tiene una imagen
        console.log(`🖼️ Es un post de imagen. No se intenta obtener la descripción externa.`);
    }

    return {
        post: {
            title: post.title, description, upvotes: post.ups, comments: post.num_comments,
            created: post.created_utc, 
            
            // 🆕 La URL que se guarda en LINK y REFERENCE
            url: externalUrl || redditPermalink, 
            
            reddit_url: redditPermalink, // URL de Reddit (para metadatos internos si es necesario)
            image: imageUrl,
        },
        comments: commentsData.data.children.filter(c => c.kind === 't1'),
        moreComments: commentsData.data.children.filter(c => c.kind === 'more').flatMap(more => more.data.children)
    };
}

async function fetchMoreComments(threadId, childrenIds) {
// ... (sin cambios) ...
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

/**
 * 🆕 MODIFICACIÓN CLAVE: Utiliza 'redditData.post.url' para 'link' y 'reference',
 * que ahora contiene la URL externa (si existe).
 */
async function createOrFindPost(redditData, entityId, moreComments) {
    let post = await Post.findOne({ entity: entityId }).maxTimeMS(TIMEOUT_MS);
    if (post) {
        console.log(`✅ Post existente encontrado: ${post._id}`);
        if (post.moreCommentsRef.length === 0 && moreComments.length > 0) {
            post.moreCommentsRef = moreComments;
            await post.save();
        }
        return post;
    }
    const postData = {
        cid: process.env.CID || 'QU-ME7HF2BN-E8QD9', entity: entityId, 
        
        // 🆕 Se usa la URL que ahora es la externa (si está disponible)
        reference: redditData.post.url, 
        title: redditData.post.title.substring(0, 100), 
        description: redditData.post.description, // Descripción obtenida del scraping
        type: 'reddit_crosspost', 
        link: redditData.post.url, // 🆕 Se usa la URL que ahora es la externa (si está disponible)
        
        image: redditData.post.image,
        likes: [], likesCount: redditData.post.upvotes || 0, commentCount: redditData.post.comments || 0,
        viewsCount: Math.floor((redditData.post.upvotes || 0) * 15),
        created_at: new Date(redditData.post.created * 1000), updated_at: new Date(redditData.post.created * 1000),
        moreCommentsRef: moreComments
    };
    post = new Post(postData);
    await post.save();
    console.log(`✅ Post creado: ${post._id}`);
    return post;
}

// ... (El resto del script, incluyendo getOrCreateProfile, processCommentsRecursively y seedRedditThread, sigue igual) ...


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
    const cityData = CITIES[Math.floor(Math.random() * CITIES.length)];
    const coordinates = generateRandomCoords(cityData.coords);

    const profileData = {
        cid: process.env.CID || 'QU-ME7HF2BN-E8QD9',
        author: generateAuthorHash(validName), name: validName, given_name: redditAuthor, family_name: 'Reddit',
        locale: 'en', email: `${validName}@reddit.quelora.com`,
        picture: `https://i.pravatar.cc/150?img=${Math.floor(Math.random() * 70) + 1}`,
        bookmarksCount: 0, commentsCount: 0, followersCount: 0, followingCount: 0,
        blockedCount: 0, likesCount: 0, sharesCount: 0,
        location: {
            type: 'Point', coordinates: coordinates, city: cityData.name, country: cityData.country,
            countryCode: cityData.countryCode, region: cityData.region, regionCode: cityData.regionCode,
            lastUpdated: new Date(), source: 'geocoding'
        },
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
        console.log(`✅ Perfil creado: ${validName} en ${cityData.name}`);
        return profile;
    } catch (error) {
        console.error(`❌ Error creando perfil para ${redditAuthor}:`, error.message);
        return null;
    }
}


async function processCommentsRecursively(commentsData, postId, entityId, allProfiles, parentId = null) {
    let createdCommentsCount = 0;
    const newMoreCommentIds = [];

    const profileIdToAuthorMap = new Map(allProfiles.map(p => [p._id.toString(), p.author]));

    for (const item of commentsData) {
        if (item.kind === 't1' && item.data.author && item.data.body && !['[deleted]', '[removed]'].includes(item.data.body)) {
            const commentData = item.data;
            if (await Comment.findOne({ reference: commentData.name }).select('_id').lean()) {
                console.log(`⏩ Comentario ya existe, saltando: ${commentData.name}`); 
                continue;
            }
            try {
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

                // --- REGISTRO DE ACTIVIDAD (GENERAL Y GEOGRÁFICA) ---
                const activityType = parentId ? 'replies' : 'comments';
                const simulatedReq = simulateRequestFromProfile(profile.toObject()); 
                
                if (simulatedReq) {
                    await recordActivityHit(`activity:${activityType}:${process.env.CID}`, 'added', 1);
                    // REGISTRO GEOGRÁFICO
                    await recordGeoActivity(simulatedReq, parentId ? 'reply' : 'comment'); 
                }
                // ---------------------------------------------------


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
                            
                            await recordActivityHit(`activity:likes:${process.env.CID}`, 'added', profileLikeDocs.length);

                            // --- REGISTRO GEOGRÁFICO para CADA LIKER (SOLUCIÓN DE GEOSTATS)
                            for (const likerProfile of selectedLikers) {
                                const likerReq = simulateRequestFromProfile(likerProfile);
                                if (likerReq) {
                                    await recordGeoActivity(likerReq, 'like');
                                }
                                accumulateProfileChanges(likerProfile._id, { likes: 1 });
                            }
                            // ---------------------------------------------
                            
                            const likerAuthors = selectedLikers.map(l => l.author);
                            await Comment.findByIdAndUpdate(newComment._id, {
                                $push: { likes: { $each: likerAuthors, $slice: -200 } }
                            });
                        }
                    }
                }

                if (parentId) await Comment.findByIdAndUpdate(parentId, { $inc: { repliesCount: 1 } });
                
                if (commentData.replies?.data?.children.length > 0) {
                    const { count, moreIds } = await processCommentsRecursively(commentData.replies.data.children, postId, entityId, allProfiles, newComment._id);
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
        
        console.log('👤 Obteniendo IDs, Autores, CID y Ubicación de perfiles para simulación...');
        // Carga masiva de datos completos de perfil (incluyendo ubicación para GeoStats)
        const allProfiles = await Profile.find({}, '_id author cid location').lean(); 
        console.log(`👍 Encontrados ${allProfiles.length} perfiles para usar como votantes.`);

        const entityId = REDDIT_THREAD_ENTITY;
        const threadId = REDDIT_THREAD_URL.match(/comments\/([a-z0-9]+)/i)[1];
        let post = await Post.findOne({ entity: entityId });

        if (!post?.metadata?.imported_comments) {
            console.log("⏳ Realizando importación inicial...");
            const redditData = await fetchRedditData(REDDIT_THREAD_URL, REDDIT_LIMIT);
            
            // ⚠️ Validación para confirmar que se ha obtenido un link de referencia
            if (!redditData.post.url || redditData.post.url.includes('reddit.com')) {
                console.warn('⚠️ No se pudo obtener una URL de referencia externa válida. Se utilizará el permalink de Reddit.');
            } else {
                console.log(`🔗 URL Externa identificada y scrapeada: ${redditData.post.url}`);
            }
                
            post = await createOrFindPost(redditData, entityId, redditData.moreComments);
            
            const { count, moreIds } = await processCommentsRecursively(redditData.comments, post._id, entityId, allProfiles, null);
            
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
                const { moreIds } = await processCommentsRecursively(newCommentsData, post._id, entityId, allProfiles, null); 
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

        console.log('🎉 Hilo de Reddit importado/actualizado exitosamente! Las GeoStats deberían estar registradas.');
    } catch (err) {
        console.error('❌ Error fatal en el seed:', err.message, err.stack);
        exitCode = 1;
    } finally {
        await mongoose.connection.close();
        console.log('✅ Conexión a DB cerrada. Finalizando script.');
        process.exit(exitCode);
    }
}

console.log('🚀 Iniciando seedRedditThread (versión 2.12)...');
seedRedditThread();