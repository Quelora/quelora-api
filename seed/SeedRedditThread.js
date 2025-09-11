// SeedRedditThread.js - Versión 2.4
// USO: CID="QU-ME7HF2BN-E8QD9" REDDIT_URL="https://www.reddit.com/r/gameofthrones/comments/bn6xey/spoilers_postepisode_discussion_season_8_episode_5/" node SeedRedditThread.js
require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const connectDB = require('../db');
const Profile = require('../models/Profile');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const crypto = require('crypto');
const axios = require('axios');
const cheerio = require('cheerio');

const REDDIT_THREAD_URL = process.env.REDDIT_URL;
const REDDIT_LIMIT = process.env.REDDIT_LIMIT || 1000;
const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID;
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET;

// Sets para almacenar autores únicos y nombres válidos para optimizar
const uniqueAuthors = new Set();
const usedValidNames = new Set();
const authorToNameMap = new Map();

// Lista de ciudades para asignar ubicaciones realistas
const CITIES = [
    { name: "New York", coords: [-74.0060, 40.7128] },
    { name: "Los Angeles", coords: [-118.2437, 34.0522] },
    { name: "Chicago", coords: [-87.6298, 41.8781] },
    { name: "London", coords: [-0.1278, 51.5074] },
    { name: "Berlin", coords: [13.4050, 52.5200] },
    { name: "Tokyo", coords: [139.6917, 35.6895] }
];

let accessToken = null;

// Configuración de timeouts y límites
const TIMEOUT_MS = 25000;
const MORE_COMMENTS_BATCH_SIZE = 100; // Límite de IDs por petición a morechildren

/**
 * Obtiene token de acceso OAuth2 de Reddit
 */
async function getRedditAccessToken() {
    try {
        console.log('🔑 Obteniendo token de acceso de Reddit...');
        const auth = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64');
        const response = await axios.post('https://www.reddit.com/api/v1/access_token',
            'grant_type=client_credentials', {
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Quelora-Seeder/2.4'
                },
                timeout: 10000
            }
        );
        accessToken = response.data.access_token;
        console.log('✅ Token de acceso obtenido exitosamente');
        return accessToken;
    } catch (error) {
        console.error('❌ Error obteniendo token de acceso:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Realiza una solicitud autenticada a la API de Reddit
 */
async function makeAuthenticatedRedditRequest(url, method = 'get', data = null) {
    if (!accessToken) {
        await getRedditAccessToken();
    }
    try {
        const config = {
            method: method,
            url: url,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'User-Agent': 'Quelora-Seeder/2.4'
            },
            timeout: TIMEOUT_MS
        };
        if (method === 'post') {
            config.data = data;
            config.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }
        const response = await axios(config);
        return response.data;
    } catch (error) {
        console.error('❌ Error en solicitud a Reddit:', error.message, error.response?.data);
        if (error.response?.status === 401) {
            console.log('🔄 Token expirado, obteniendo nuevo token...');
            await getRedditAccessToken();
            return makeAuthenticatedRedditRequest(url, method, data);
        }
        throw error;
    }
}

/**
 * Genera coordenadas aleatorias alrededor de una ciudad
 */
const generateRandomCoords = (baseCoords) => {
    const [lon, lat] = baseCoords;
    const latOffset = (Math.random() - 0.5) * 0.2;
    const lonOffset = (Math.random() - 0.5) * 0.2;
    return [parseFloat((lon + lonOffset).toFixed(6)), parseFloat((lat + latOffset).toFixed(6))];
};

/**
 * Genera entity ID SHA-256 de 24 caracteres
 */
const generateEntityId = (reference) => {
    return crypto.createHash('sha256')
        .update(reference)
        .digest('hex')
        .substring(0, 24);
};

/**
 * Genera author SHA-256 de 64 caracteres basado en el nombre
 */
const generateAuthorHash = (name) => {
    return crypto.createHash('sha256')
        .update(name)
        .digest('hex');
};

/**
 * Genera un nombre válido (solo letras y números, 3-15 caracteres)
 */
const generateValidName = (redditUsername) => {
    const cleanName = redditUsername.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    let validName = cleanName.substring(0, 15);
    if (validName.length < 3) {
        validName = 'rdt' + Math.random().toString(36).substring(2, 5);
    }
    let counter = 0;
    while (true) {
        const suffix = counter === 0 ? '' : counter.toString();
        const maxBaseLength = 15 - suffix.length;
        const base = validName.substring(0, maxBaseLength);
        const finalName = base + suffix;
        if (finalName.length < 3) {
            // Rare case, regenerate with random
            validName = 'rdt' + Math.random().toString(36).substring(2, 12);
            counter = 0;
            continue;
        }
        if (!usedValidNames.has(finalName)) {
            usedValidNames.add(finalName);
            return finalName;
        }
        counter++;
        if (counter > 100) {
            console.error(`⚠️ Too many attempts to generate unique name for ${redditUsername}`);
            throw new Error('Name generation failed');
        }
    }
};

/**
 * Decodifica entidades HTML (como &amp; a &)
 */
const decodeHtmlEntities = (str) => {
    if (!str) return str;
    return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
};

/**
 * Extrae descripción e imagen de una página web
 */
async function scrapeWebpage(url) {
    try {
        console.log(`🌐 Scrapeando página web: ${url}`);
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Quelora-Seeder/2.4' },
            timeout: TIMEOUT_MS
        });
        const $ = cheerio.load(response.data);

        // Extraer descripción (meta description o og:description)
        let description = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '';
        description = decodeHtmlEntities(description);

        // Extraer imagen (og:image o primera imagen del artículo)
        let image = $('meta[property="og:image"]').attr('content') || $('article img').first().attr('src') || null;
        image = decodeHtmlEntities(image);

        // Asegurar que la imagen sea una URL absoluta
        if (image && !image.startsWith('http')) {
            const urlObj = new URL(url);
            image = new URL(image, urlObj.origin).href;
        }

        console.log(`📝 Descripción extraída: ${description ? description.substring(0, 50) + '...' : 'Ninguna'}`);
        console.log(`🖼️ Imagen extraída: ${image || 'Ninguna'}`);
        return { description, image };
    } catch (error) {
        console.error(`❌ Error scrapeando ${url}:`, error.message);
        return { description: '', image: null };
    }
}

/**
 * Obtiene datos iniciales del hilo de Reddit
 */
async function fetchRedditData(threadUrl, limit = 1000) {
    try {
        const threadMatch = threadUrl.match(/comments\/([a-z0-9]+)/i);
        if (!threadMatch) throw new Error('URL de Reddit inválida');
        
        const threadId = threadMatch[1];
        const subreddit = threadUrl.split('/r/')[1].split('/')[0];
        
        const apiUrl = `https://oauth.reddit.com/r/${subreddit}/comments/${threadId}.json?limit=${limit}&threaded=true&sort=top`;
        
        console.log(`📡 Obteniendo datos iniciales de: ${apiUrl}`);
        const response = await makeAuthenticatedRedditRequest(apiUrl);

        const [postData, commentsData] = response;
        const post = postData.data.children[0].data;
        const comments = commentsData.data.children;

        console.log(`📦 Total de elementos de primer nivel obtenidos: ${comments.length}`);

        const moreComments = comments
            .filter(c => c.kind === 'more')
            .flatMap(more => more.data.children);

        const validComments = comments.filter(c => c.kind === 't1');

        console.log(`✅ Comentarios válidos iniciales: ${validComments.length}`);
        console.log(`⏩ "More" comments de nivel superior encontrados: ${moreComments.length}`);

        // Determinar la URL de la imagen desde Reddit
        let imageUrl = null;
        if (post.preview && post.preview.images && post.preview.images.length > 0) {
            imageUrl = decodeHtmlEntities(post.preview.images[0].source.url);
        } else if (post.url && (post.url.endsWith('.jpg') || post.url.endsWith('.png') || post.url.endsWith('.gif'))) {
            imageUrl = decodeHtmlEntities(post.url);
        } else if (post.url_overridden_by_dest && (post.url_overridden_by_dest.endsWith('.jpg') || post.url_overridden_by_dest.endsWith('.png') || post.url_overridden_by_dest.endsWith('.gif'))) {
            imageUrl = decodeHtmlEntities(post.url_overridden_by_dest);
        }

        // Obtener descripción e imagen desde la página web si es un link post
        let description = post.selftext || '';
        let scrapedImage = imageUrl;
        if (!description && post.url && !post.is_self && post.url.startsWith('http')) {
            const scrapedData = await scrapeWebpage(post.url);
            description = scrapedData.description || '';
            if (!imageUrl) {
                scrapedImage = scrapedData.image || null;
            }
        }

        console.log(`📝 Descripción final: ${description ? description.substring(0, 50) + '...' : 'Ninguna'}`);
        console.log(`🖼️ Imagen final: ${scrapedImage || 'Ninguna'}`);

        return {
            post: {
                title: post.title,
                content: post.selftext || '',
                upvotes: post.ups,
                comments: post.num_comments,
                created: post.created_utc,
                author: post.author,
                url: `https://reddit.com${post.permalink}`,
                image: scrapedImage,
                description: description
            },
            comments: validComments,
            moreComments: moreComments
        };
    } catch (error) {
        console.error('❌ Error obteniendo datos de Reddit:', error.message);
        throw error;
    }
}

/**
 * Obtiene comentarios adicionales usando la API morechildren
 */
async function fetchMoreComments(threadId, childrenIds) {
    try {
        console.log(`📡 Obteniendo lote de ${childrenIds.length} comentarios adicionales...`);
        console.log(`IDs (primeros 5): ${childrenIds.slice(0, 5).join(', ')}...`);
        const apiUrl = `https://oauth.reddit.com/api/morechildren`;
        const data = new URLSearchParams({
            api_type: 'json',
            children: childrenIds.join(','),
            link_id: `t3_${threadId}`,
            sort: 'top',
        });
        
        const response = await makeAuthenticatedRedditRequest(apiUrl, 'post', data);
        const comments = response.json?.data?.things || [];
        console.log(`📦 Lote obtenido: ${comments.length} comentarios.`);
        return comments;
    } catch (error) {
        console.error('❌ Error obteniendo "more" comments:', error.message, error.response?.data);
        return [];
    }
}

/**
 * Crea o obtiene un perfil para un autor de Reddit
 */
async function getOrCreateProfile(redditAuthor) {
    console.log(`⏳ Buscando/Creando perfil para ${redditAuthor}...`);
    let validName;
    if (authorToNameMap.has(redditAuthor)) {
        validName = authorToNameMap.get(redditAuthor);
        console.log(`🔍 Usando nombre mapeado: ${validName}`);
        const existingProfile = await Profile.findOne({ name: validName }).maxTimeMS(TIMEOUT_MS);
        if (existingProfile) {
            console.log(`✅ Perfil existente encontrado: ${validName}`);
            return existingProfile;
        }
        console.warn(`⚠️ Perfil no encontrado con nombre mapeado, procediendo a crear nuevo.`);
    }

    validName = generateValidName(redditAuthor);
    console.log(`🔍 Buscando perfil con nombre generado: ${validName}`);
    const existingProfile = await Profile.findOne({ name: validName }).maxTimeMS(TIMEOUT_MS);
    if (existingProfile) {
        console.log(`✅ Perfil existente: ${validName}`);
        authorToNameMap.set(redditAuthor, validName);
        uniqueAuthors.add(redditAuthor);
        return existingProfile;
    }

    uniqueAuthors.add(redditAuthor);
    authorToNameMap.set(redditAuthor, validName);
    const authorHash = generateAuthorHash(validName);
    const city = CITIES[Math.floor(Math.random() * CITIES.length)];
    const coordinates = generateRandomCoords(city.coords);

    const profileData = {
        cid: process.env.CID || 'QU-ME7HF2BN-E8QD9',
        author: authorHash,
        name: validName,
        given_name: redditAuthor,
        family_name: 'Reddit',
        locale: 'en',
        email: `${validName}@reddit.quelora.com`,
        picture: `https://i.pravatar.cc/150?img=${Math.floor(Math.random() * 70) + 1}`,
        bookmarksCount: 0,
        commentsCount: 0,
        followersCount: 0,
        followingCount: 0,
        blockedCount: 0,
        likesCount: 0,
        sharesCount: 0,
        location: {
            type: 'Point',
            coordinates: coordinates,
            city: city.name,
            countryCode: 'US',
            regionCode: 'CA',
            lastUpdated: new Date(),
            source: 'geocoding'
        },
        geohash: null,
        settings: {
            notifications: { web: false, email: false, push: false, newFollowers: false, postLikes: false, comments: false, newPost: false },
            privacy: { followerApproval: false, showActivity: 'everyone' },
            interface: { defaultLanguage: 'en', defaultTheme: 'system' },
            session: { rememberSession: true }
        },
        created_at: new Date(),
        updated_at: new Date()
    };

    try {
        const profile = new Profile(profileData);
        await profile.save();
        console.log(`✅ Perfil creado: ${validName}`);
        return profile;
    } catch (error) {
        console.error(`❌ Error creando perfil para ${redditAuthor}:`, error.message);
        return null;
    }
}

/**
 * Crea o encuentra el post y actualiza los "moreCommentsRef"
 */
async function createOrFindPost(redditData, entityId, moreComments) {
    let post = await Post.findOne({ entity: entityId }).maxTimeMS(TIMEOUT_MS);
    if (post) {
        console.log(`✅ Post existente encontrado: ${post._id}`);
        if (post.moreCommentsRef.length === 0 && moreComments.length > 0) {
            post.moreCommentsRef = moreComments;
            await post.save();
            console.log(`✍️ Post actualizado con ${moreComments.length} "more" comment refs.`);
        }
        return post;
    }

    const postData = {
        cid: process.env.CID || 'QU-ME7HF2BN-E8QD9',
        entity: entityId,
        reference: redditData.post.url,
        title: redditData.post.title.substring(0, 100),
        description: redditData.post.description || '', // Use scraped or Reddit description
        type: 'reddit_crosspost',
        link: redditData.post.url,
        image: redditData.post.image || null, // Use scraped or Reddit image
        likesCount: redditData.post.upvotes || 0,
        commentCount: redditData.post.comments || 0,
        viewsCount: Math.floor((redditData.post.upvotes || 0) * 15),
        created_at: new Date(redditData.post.created * 1000),
        updated_at: new Date(redditData.post.created * 1000),
        moreCommentsRef: moreComments
    };

    try {
        post = new Post(postData);
        await post.save();
        console.log(`✅ Post creado: ${post._id}`);
        return post;
    } catch (error) {
        console.error(`❌ Error creando post:`, error.message);
        throw error;
    }
}

/**
 * Función recursiva para procesar y crear comentarios y sus réplicas.
 */
async function processCommentsRecursively(commentsData, postId, entityId, parentId = null) {
    console.log(`⏳ Iniciando procesamiento recursivo de ${commentsData.length} items (parent: ${parentId || 'top-level'}).`);
    let createdCommentsCount = 0;
    const newMoreCommentIds = [];

    for (const item of commentsData) {
        console.log(`📄 Procesando item kind: ${item.kind}, id: ${item.data.id || item.data.name || 'N/A'}`);
        if (item.kind === 't1' && item.data.author && item.data.body && item.data.body !== '[deleted]' && item.data.body !== '[removed]') {
            const commentData = item.data;
            console.log(`👤 Autor: ${commentData.author}, body length: ${commentData.body.length}`);

            const existingComment = await Comment.findOne({ reference: commentData.name }).select('_id').lean();
            if (existingComment) {
                console.log(`⏩ Comentario ya existe, saltando: ${commentData.name}`);
                continue;
            }

            try {
                const profile = await getOrCreateProfile(commentData.author);
                if (!profile) {
                    console.warn(`⚠️ No se pudo crear el perfil para ${commentData.author}, saltando comentario.`);
                    continue;
                }
                
                const newComment = new Comment({
                    post: postId,
                    entity: entityId,
                    parent: parentId,
                    profile_id: profile._id,
                    author: profile.author,
                    reference: commentData.name,
                    text: commentData.body,
                    language: 'en',
                    likesCount: commentData.ups || 0,
                    repliesCount: 0, // Initialize to 0, will be updated if replies exist
                    created_at: new Date(commentData.created_utc * 1000),
                    updated_at: new Date(commentData.created_utc * 1000)
                });

                await newComment.save();
                createdCommentsCount++;
                console.log(`✅ Comentario creado (Nivel ${parentId ? 'Réplica' : 'Superior'}): ${commentData.author} - "${commentData.body.substring(0, 30)}..." (ID: ${newComment._id})`);

                // Increment repliesCount for the parent comment if this is a reply
                if (parentId) {
                    await Comment.findByIdAndUpdate(parentId, {
                        $inc: { repliesCount: 1 },
                        updated_at: new Date()
                    });
                    console.log(`📈 Incrementado repliesCount para comentario padre ${parentId}`);
                }
                
                if (commentData.replies && commentData.replies.kind === 'Listing' && commentData.replies.data.children.length > 0) {
                    console.log(`🔄 Recursando en ${commentData.replies.data.children.length} réplicas...`);
                    const { count, moreIds } = await processCommentsRecursively(
                        commentData.replies.data.children,
                        postId,
                        entityId,
                        newComment._id
                    );
                    createdCommentsCount += count;
                    newMoreCommentIds.push(...moreIds);
                }
            } catch (error) {
                console.error(`❌ Error creando comentario de ${commentData.author}:`, error.message);
            }
        }
        else if (item.kind === 'more' && item.data.children) {
            console.log(`⏩ Encontrado 'more' con ${item.data.children.length} children IDs.`);
            newMoreCommentIds.push(...item.data.children);
        } else {
            console.warn(`⚠️ Item desconocido o inválido: kind ${item.kind}`);
        }
    }
    console.log(`🏁 Finalizado procesamiento recursivo: ${createdCommentsCount} creados, ${newMoreCommentIds.length} more IDs recolectados.`);
    return { count: createdCommentsCount, moreIds: newMoreCommentIds };
}

/**
 * Función principal que orquesta todo el proceso
 */
async function seedRedditThread() {
    try {
        if (!REDDIT_THREAD_URL) throw new Error('❌ REDDIT_URL no definido');
        if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) throw new Error('❌ Credenciales de Reddit no configuradas');

        await connectDB();
        console.log('✅ Conexión a DB establecida');
        await getRedditAccessToken();

        const entityId = generateEntityId(REDDIT_THREAD_URL);
        const threadId = REDDIT_THREAD_URL.match(/comments\/([a-z0-9]+)/i)[1];

        let post = await Post.findOne({ entity: entityId });

        if (!post) {
            console.log("⏳ Post no encontrado. Realizando importación inicial...");
            const redditData = await fetchRedditData(REDDIT_THREAD_URL, REDDIT_LIMIT);
            post = await createOrFindPost(redditData, entityId, redditData.moreComments);

            console.log(`⏳ Creando comentarios iniciales y sus réplicas...`);
            const { count, moreIds } = await processCommentsRecursively(redditData.comments, post._id, entityId);

            if (moreIds.length > 0) {
                post.moreCommentsRef.push(...moreIds);
                await Post.findByIdAndUpdate(post._id, { $addToSet: { moreCommentsRef: { $each: moreIds } } });
            }
            console.log(`✅ ${count} comentarios iniciales creados.`);
        } else {
            console.log("✅ Post encontrado. Buscando comentarios pendientes para reanudar...");
        }

        let originalMoreLength = post.moreCommentsRef.length;
        post.moreCommentsRef = [...new Set(post.moreCommentsRef)];
        if (post.moreCommentsRef.length < originalMoreLength) {
            console.log(`⚠️ Eliminados ${originalMoreLength - post.moreCommentsRef.length} duplicados en moreCommentsRef.`);
            await post.save();
        }
        console.log(`📊 moreCommentsRef inicial después de dedup: ${post.moreCommentsRef.length}`);

        while (post.moreCommentsRef.length > 0) {
            const idsToFetch = post.moreCommentsRef.slice(0, MORE_COMMENTS_BATCH_SIZE);
            console.log(`\n⏳ Procesando lote de ${idsToFetch.length} "more" comment IDs...`);

            const newCommentsData = await fetchMoreComments(threadId, idsToFetch);
            
            if (newCommentsData.length > 0) {
                const { count, moreIds } = await processCommentsRecursively(newCommentsData, post._id, entityId);
                console.log(`✅ ${count} comentarios adicionales creados desde el lote. ${moreIds.length} nuevos more IDs encontrados.`);

                let updatedMoreRefs = post.moreCommentsRef.slice(idsToFetch.length);
                updatedMoreRefs.push(...moreIds);
                updatedMoreRefs = [...new Set(updatedMoreRefs)];
                
                await Post.findByIdAndUpdate(post._id, { 
                    $set: { moreCommentsRef: updatedMoreRefs }
                });
                post.moreCommentsRef = updatedMoreRefs;

            } else {
                console.log("⚠️ No se recibieron comentarios del lote, eliminando IDs procesados.");
                await Post.findByIdAndUpdate(post._id, { $pullAll: { moreCommentsRef: idsToFetch } });
                post.moreCommentsRef = post.moreCommentsRef.slice(idsToFetch.length);
            }
            console.log(`📊 moreCommentsRef restantes: ${post.moreCommentsRef.length}`);
            
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.log('⏳ Actualizando conteo final de comentarios en el post...');
        const finalCommentCount = await Comment.countDocuments({ post: post._id });
        await Post.findByIdAndUpdate(post._id, {
            commentCount: finalCommentCount,
            updated_at: new Date()
        });

        console.log('🎉 Hilo de Reddit importado/actualizado exitosamente!');
        console.log(`   - Post: ${post._id}`);
        console.log(`   - Total comentarios en DB: ${finalCommentCount}`);
        console.log(`   - Perfiles únicos creados/usados: ${uniqueAuthors.size}`);

    } catch (err) {
        console.error('❌ Error fatal en el seed:', err.message, err.stack);
        process.exitCode = 1;
    } finally {
        console.log('⏳ Cerrando conexión a la base de datos...');
        await mongoose.connection.close();
        console.log('✅ Conexión cerrada. Finalizando script.');
        process.exit(process.exitCode || 0);
    }
}

console.log('🚀 Iniciando seedRedditThread (versión 2.4)...');
seedRedditThread();