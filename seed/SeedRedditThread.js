// SeedRedditThread.js - Versión con sistema de likes
// USO: node SeedRedditThread.js

require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const connectDB = require('../db');
const Post = require('../models/Post');
const Profile = require('../models/Profile');
const ProfileLike = require('../models/ProfileLike');
const axios = require('axios');
const crypto = require('crypto');

const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID;
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET;
const POST_LIMIT = process.env.TRENDING_LIMIT || 500;
const MIN_COMMENTS = process.env.MIN_COMMENTS || 50;

// --- ESTRATEGIA DE BATCHING PARA CONTADORES DE PERFILES ---
const profileUpdatesMap = new Map(); // Mapa para acumular { profileId: { likes: N } }
const TIMEOUT_MS = 25000;
// -----------------------------------------------------------

// Subreddits de tecnología/programación a monitorear
const TECH_SUBREDDITS = [
    'programming', 'technology', 'computerscience', 'coding', 
    'webdev', 'learnprogramming', 'compsci', 'softwareengineering',
    'artificial', 'MachineLearning', 'datascience', 'python',
    'javascript', 'java', 'cpp', 'golang', 'rust', 'php',
    'reactjs', 'node', 'vuejs', 'angular', 'django', 'flask',
    'devops', 'sysadmin', 'cybersecurity', 'networking',
    'apple', 'android', 'windows', 'linux', 'macos'
];

let accessToken = null;

/**
 * Acumula los incrementos en memoria para realizar una actualización eficiente en lote al final.
 */
function accumulateProfileChanges(profileId, changes) {
    const current = profileUpdatesMap.get(profileId.toString()) || { likes: 0 };
    profileUpdatesMap.set(profileId.toString(), {
        likes: current.likes + (changes.likes || 0)
    });
}

/**
 * Realiza la actualización final en lote de los contadores de perfiles usando $inc.
 */
async function bulkUpdateProfileCounters() {
    if (profileUpdatesMap.size === 0) return;

    console.log(`⏳ Iniciando actualización en lote para ${profileUpdatesMap.size} perfiles...`);
    const bulkOps = [];
    
    for (const [profileId, changes] of profileUpdatesMap.entries()) {
        const update = {};
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
                    'User-Agent': 'TechPosts-Importer/1.0'
                },
                timeout: 10000
            }
        );
        accessToken = response.data.access_token;
        console.log('✅ Token de acceso obtenido');
        return accessToken;
    } catch (error) {
        console.error('❌ Error obteniendo token:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Realiza solicitud autenticada a Reddit API
 */
async function makeRedditRequest(url) {
    if (!accessToken) {
        await getRedditAccessToken();
    }
    
    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'User-Agent': 'TechPosts-Importer/1.0'
            },
            timeout: 15000
        });
        return response.data;
    } catch (error) {
        console.error('❌ Error en solicitud a Reddit:', error.message);
        if (error.response?.status === 401) {
            console.log('🔄 Token expirado, obteniendo nuevo...');
            await getRedditAccessToken();
            return makeRedditRequest(url);
        }
        throw error;
    }
}

/**
 * Obtiene posts populares de tecnología con mínimo de comentarios
 */
async function fetchTechPostsWithComments() {
    try {
        console.log(`📡 Buscando posts de tecnología con ≥ ${MIN_COMMENTS} comentarios...`);
        
        let allPosts = [];
        
        // Buscar en cada subreddit de tecnología
        for (const subreddit of TECH_SUBREDDITS) {
            try {
                console.log(`🔍 Escaneando r/${subreddit}...`);
                const url = `https://oauth.reddit.com/r/${subreddit}/top?t=day&limit=20`;
                const data = await makeRedditRequest(url);
                
                const posts = data.data.children
                    .filter(post => post.data.num_comments >= MIN_COMMENTS) // Filtro por comentarios
                    .filter(post => !post.data.over_18) // Excluir NSFW
                    .map(post => ({
                        id: post.data.id,
                        title: post.data.title,
                        subreddit: post.data.subreddit,
                        author: post.data.author,
                        upvotes: post.data.ups,
                        comments: post.data.num_comments,
                        created: post.data.created_utc,
                        url: `https://reddit.com${post.data.permalink}`,
                        image: getPostImage(post.data),
                        video: getPostVideo(post.data),
                        gallery: getPostGallery(post.data),
                        media: getPostMedia(post.data),
                        description: post.data.selftext || '',
                        nsfw: post.data.over_18
                    }));
                
                console.log(`✅ r/${subreddit}: ${posts.length} posts con ≥ ${MIN_COMMENTS} comentarios`);
                allPosts = allPosts.concat(posts);
                
                // Pequeña pausa entre requests
                await new Promise(resolve => setTimeout(resolve, 500));
                
            } catch (error) {
                console.error(`❌ Error en r/${subreddit}:`, error.message);
                continue;
            }
        }
        
        // Eliminar duplicados por URL y ordenar por comentarios (descendente)
        const uniquePosts = allPosts.filter((post, index, self) => 
            index === self.findIndex(p => p.url === post.url)
        ).sort((a, b) => b.comments - a.comments);
        
        console.log(`🎯 Total posts únicos encontrados: ${uniquePosts.length} (≥ ${MIN_COMMENTS} comentarios)`);
        return uniquePosts.slice(0, POST_LIMIT); // Limitar resultado
        
    } catch (error) {
        console.error('❌ Error obteniendo posts de tecnología:', error.message);
        throw error;
    }
}

/**
 * Extrae imagen del post si existe
 */
function getPostImage(postData) {
    // Imagen desde preview
    if (postData.preview && postData.preview.images && postData.preview.images.length > 0) {
        return postData.preview.images[0].source.url.replace(/&amp;/g, '&');
    }
    
    // Imagen directa desde URL
    if (postData.url && (
        postData.url.endsWith('.jpg') || 
        postData.url.endsWith('.jpeg') ||
        postData.url.endsWith('.png') ||
        postData.url.endsWith('.gif') ||
        postData.url.includes('imgur.com') ||
        postData.url.includes('i.redd.it')
    )) {
        return postData.url;
    }
    
    // Thumbnail
    if (postData.thumbnail && postData.thumbnail.startsWith('http')) {
        return postData.thumbnail;
    }
    
    return null;
}

/**
 * Extrae video del post si existe
 */
function getPostVideo(postData) {
    if (postData.media && postData.media.reddit_video) {
        return postData.media.reddit_video.fallback_url;
    }
    
    if (postData.url && (
        postData.url.includes('youtube.com') ||
        postData.url.includes('youtu.be') ||
        postData.url.includes('vimeo.com') ||
        postData.url.includes('twitch.tv') ||
        postData.url.endsWith('.mp4') ||
        postData.url.endsWith('.webm') ||
        postData.url.includes('gfycat.com') ||
        postData.url.includes('redgifs.com')
    )) {
        return postData.url;
    }
    
    return null;
}

/**
 * Extrae galería de imágenes si existe
 */
function getPostGallery(postData) {
    if (postData.is_gallery && postData.media_metadata) {
        const galleryImages = [];
        for (const [key, item] of Object.entries(postData.media_metadata)) {
            if (item.s && item.s.u) {
                galleryImages.push(item.s.u.replace(/&amp;/g, '&'));
            }
        }
        return galleryImages.length > 0 ? galleryImages : null;
    }
    return null;
}

/**
 * Extrae cualquier tipo de medio disponible
 */
function getPostMedia(postData) {
    return {
        image: getPostImage(postData),
        video: getPostVideo(postData),
        gallery: getPostGallery(postData)
    };
}

/**
 * Verifica si el post tiene al menos un elemento multimedia
 */
function hasMediaContent(postData) {
    return !!(postData.image || postData.video || postData.gallery);
}

/**
 * Obtiene la URL principal del medio para el post
 */
function getPrimaryMediaUrl(postData) {
    if (postData.video) return postData.video;
    if (postData.image) return postData.image;
    if (postData.gallery && postData.gallery.length > 0) return postData.gallery[0];
    return null;
}

/**
 * Genera entity ID único basado en URL de Reddit
 */
function generateEntityId(redditUrl) {
    return crypto.createHash('sha256')
        .update(redditUrl)
        .digest('hex')
        .substring(0, 24);
}

/**
 * Verifica si el post ya existe en la base de datos
 */
async function postExists(entityId) {
    const existing = await Post.findOne({ entity: entityId });
    return !!existing;
}

/**
 * Simula likes para un post usando perfiles existentes
 */
async function simulatePostLikes(postId, likesCount, allProfileIds) {
    if (likesCount <= 0 || allProfileIds.length === 0) {
        return [];
    }

    try {
        // Mapeamos los IDs de MongoDB a sus autores (hashes) para los likers
        const profileIdToAuthorMap = new Map(allProfileIds.map(p => [p._id.toString(), p.author]));
        
        const shuffledLikerPool = [...allProfileIds].sort(() => 0.5 - Math.random());
        const numLikesToCreate = Math.min(likesCount, shuffledLikerPool.length);
        const selectedLikers = shuffledLikerPool.slice(0, numLikesToCreate);
        
        const profileLikeDocs = selectedLikers.map(liker => ({ 
            profile_id: liker._id, 
            fk_id: postId, 
            fk_type: 'post' 
        }));
        
        if (profileLikeDocs.length > 0) {
            await ProfileLike.insertMany(profileLikeDocs);
            console.log(`❤️  ${profileLikeDocs.length} likes simulados para el post ${postId}`);
            
            // OBTENEMOS EL CAMPO 'author' (HASH) para el array de likes
            const likerAuthors = selectedLikers.map(l => profileIdToAuthorMap.get(l._id.toString()) || l.author);
            
            // SE AÑADEN AL ARRAY DE LIKES DEL POST USANDO EL HASH DEL AUTOR
            await Post.findByIdAndUpdate(postId, {
                $push: { likes: { $each: likerAuthors, $slice: -200 } }
            });
            console.log(`✍️  Añadidos ${likerAuthors.length} autores (hashes) al array de likes del post.`);

            // Acumular conteo de likes para cada votante
            for (const liker of selectedLikers) {
                accumulateProfileChanges(liker._id, { likes: 1 });
            }
            
            return likerAuthors;
        }
        
        return [];
    } catch (error) {
        console.error(`❌ Error simulando likes para post ${postId}:`, error.message);
        return [];
    }
}

/**
 * Importa un post a la base de datos SOLO si tiene contenido multimedia
 */
async function importPost(postData, allProfileIds) {
    // Verificar que el post tenga al menos un elemento multimedia
    if (!hasMediaContent(postData)) {
        console.log(`❌ Post sin multimedia - SKIPPED: r/${postData.subreddit} - ${postData.title.substring(0, 60)}...`);
        return { skipped: true, reason: 'no_media' };
    }
    
    const entityId = generateEntityId(postData.url);
    
    if (await postExists(entityId)) {
        console.log(`⏩ Post ya existe: r/${postData.subreddit} - ${postData.title.substring(0, 60)}...`);
        return { skipped: true, reason: 'exists' };
    }
    
    try {
        const primaryMedia = getPrimaryMediaUrl(postData);
        
        const post = new Post({
            cid: process.env.CID || 'QU-ME7HF2BN-E8QD9',
            entity: entityId,
            reference: postData.url,
            title: postData.title.substring(0, 100),
            description: postData.description.substring(0, 200) || '',
            type: 'reddit_tech',
            link: postData.url,
            image: primaryMedia, // Usar el medio principal
            media: postData.media, // Guardar todos los medios disponibles
            likesCount: postData.upvotes,
            commentCount: postData.comments,
            viewsCount: 0, // Sin simulación
            created_at: new Date(postData.created * 1000),
            updated_at: new Date(postData.created * 1000),
            metadata: {
                subreddit: postData.subreddit,
                author: postData.author,
                nsfw: postData.nsfw,
                original_comments: postData.comments,
                imported_comments: false,
                has_image: !!postData.image,
                has_video: !!postData.video,
                has_gallery: !!postData.gallery,
                media_count: postData.gallery ? postData.gallery.length : 0
            }
        });
        
        await post.save();
        console.log(`✅ Post importado: r/${postData.subreddit} (${postData.comments} comentarios, ${getMediaType(postData)}) - ${postData.title.substring(0, 50)}...`);
        
        // SIMULAR LIKES PARA EL POST (misma lógica que en comentarios)
        if (postData.upvotes > 0 && allProfileIds.length > 0) {
            await simulatePostLikes(post._id, postData.upvotes, allProfileIds);
        }
        
        return { success: true, post };
    } catch (error) {
        console.error(`❌ Error importando post:`, error.message);
        return { error: true };
    }
}

/**
 * Obtiene el tipo de medio para logging
 */
function getMediaType(postData) {
    if (postData.video) return 'video';
    if (postData.gallery) return `gallery(${postData.gallery.length} images)`;
    if (postData.image) return 'image';
    return 'no media';
}

/**
 * Función principal
 */
async function importTechPostsWithComments() {
    try {
        if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) {
            throw new Error('❌ Credenciales de Reddit no configuradas en .env');
        }
        
        await connectDB();
        console.log('✅ Conectado a la base de datos');
        
        // Obtener perfiles existentes para simulación de likes (misma lógica que en comentarios)
        console.log('👤 Obteniendo IDs y Autores de perfiles para simulación de likes...');
        const allProfileIds = await Profile.find({}, '_id author').lean(); 
        console.log(`👍 Encontrados ${allProfileIds.length} perfiles para usar como votantes.`);
        
        const techPosts = await fetchTechPostsWithComments();
        
        console.log(`\n📥 Filtrando posts con contenido multimedia...`);
        
        // Filtrar posts que tienen contenido multimedia
        const postsWithMedia = techPosts.filter(hasMediaContent);
        
        console.log(`📊 Estadísticas de contenido multimedia:`);
        console.log(`   📈 Total posts encontrados: ${techPosts.length}`);
        console.log(`   🖼️  Posts con multimedia: ${postsWithMedia.length}`);
        console.log(`   📝 Posts sin multimedia: ${techPosts.length - postsWithMedia.length}`);
        
        console.log(`\n📥 Importando ${postsWithMedia.length} posts con contenido multimedia...`);
        let imported = 0;
        let skipped = 0;
        let noMediaSkipped = 0;
        let errors = 0;
        
        for (const post of techPosts) {
            const result = await importPost(post, allProfileIds);
            
            if (result.skipped) {
                if (result.reason === 'no_media') {
                    noMediaSkipped++;
                } else {
                    skipped++;
                }
            } else if (result.success) {
                imported++;
            } else {
                errors++;
            }
            
            // Pausa para no saturar la API
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        // --- PASO CLAVE: ACTUALIZACIÓN FINAL DE CONTADORES ---
        await bulkUpdateProfileCounters(); 
        // ---------------------------------------------------
        
        console.log(`\n🎉 Importación completada:`);
        console.log(`   ✅ Nuevos posts con multimedia: ${imported}`);
        console.log(`   ⏩ Ya existían: ${skipped}`);
        console.log(`   🚫 Sin multimedia (omitidos): ${noMediaSkipped}`);
        console.log(`   ❌ Errores: ${errors}`);
        console.log(`   📊 Total analizados: ${techPosts.length}`);
        console.log(`   💬 Filtro: ≥ ${MIN_COMMENTS} comentarios + multimedia obligatorio`);
        console.log(`   🔧 Subreddits monitoreados: ${TECH_SUBREDDITS.length}`);
        console.log(`   ❤️  Likes simulados usando ${allProfileIds.length} perfiles existentes`);
        
    } catch (error) {
        console.error('❌ Error en importación:', error.message);
    } finally {
        await mongoose.connection.close();
        console.log('✅ Conexión cerrada');
        process.exit(0); 
    }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
    console.log('🚀 Iniciando importación de posts de tecnología con comentarios Y multimedia Y sistema de likes...');
    importTechPostsWithComments();
}

module.exports = { importTechPostsWithComments };