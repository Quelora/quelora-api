// SeedRedditThread.js - Versión 2.20 (FINAL: Elimina 'hit', Registra Likes Agregados y Desagregados)

require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const connectDB = require('../db');
const Post = require('../models/Post');
const Profile = require('../models/Profile');
const ProfileLike = require('../models/ProfileLike');
const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');
const { recordActivityHit, recordGeoActivity } = require('../utils/recordStatsActivity'); 

const { CITIES } = require('./config/geoData'); 

const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID;
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET;
const POST_LIMIT = process.env.TRENDING_LIMIT || 500;
const MIN_COMMENTS = process.env.MIN_COMMENTS || 50;

const profileUpdatesMap = new Map(); 
const TIMEOUT_MS = 25000;

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

function simulateRequestFromProfile(profile) {
    const geo = profile.location;

    if (!profile || !geo || !profile.cid || !geo.coordinates || geo.coordinates.length < 2) {
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

const decodeHtmlEntities = (str) => str ? str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : str;

async function scrapeRedditForExternalLink(redditPermalink) {
    try {
        console.log(`🔎 Scrapeando HTML de Reddit para link externo: ${redditPermalink}`);
        const { data } = await axios.get(redditPermalink, { headers: { 'User-Agent': 'TechPosts-Importer/2.20' }, timeout: TIMEOUT_MS });
        const $ = cheerio.load(data);
        
        const selector = 'faceplate-tracker a[target="_blank"][rel*="noopener"][rel*="nofollow"][class*="border-solid"]';

        const externalAnchor = $(selector).first();
        
        if (externalAnchor.length > 0) {
            const externalHref = externalAnchor.attr('href');
            console.log(`✅ Link externo encontrado en el HTML de Reddit: ${externalHref}`);
            return externalHref;
        }

        return null;
    } catch (error) {
        console.error(`❌ Error al intentar scrapear el permalink de Reddit: ${error.message}`);
        return null;
    }
}

async function scrapeWebpage(url) {
    try {
        console.log(`🌍 Intentando scrapeo de la descripción de: ${url}`);
        const { data } = await axios.get(url, { headers: { 'User-Agent': 'TechPosts-Importer/2.20' }, timeout: TIMEOUT_MS });
        const $ = cheerio.load(data);
        
        let description = $('meta[name="description"]').attr('content') 
                         || $('meta[property="og:description"]').attr('content') 
                         || '';
        
        if (!description) {
            const firstParagraph = $('p').first().text();
            if (firstParagraph && firstParagraph.length > 50) {
                description = firstParagraph.substring(0, 300) + '...'; 
            }
        }

        return decodeHtmlEntities(description) || '';
    } catch (error) {
        console.error(`⚠️ Error scraping descripción de ${url}: ${error.message}`);
        return '';
    }
}

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

async function getRedditAccessToken() {
    try {
        console.log('🔑 Obteniendo token de acceso de Reddit...');
        const auth = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64');
        const response = await axios.post('https://www.reddit.com/api/v1/access_token',
            'grant_type=client_credentials', {
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'TechPosts-Importer/2.20'
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

async function makeRedditRequest(url) {
    if (!accessToken) {
        await getRedditAccessToken();
    }
    
    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'User-Agent': 'TechPosts-Importer/2.20'
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

async function fetchTechPostsWithComments() {
    try {
        console.log(`📡 Buscando posts de tecnología con ≥ ${MIN_COMMENTS} comentarios...`);
        
        let allPosts = [];
        
        for (const subreddit of TECH_SUBREDDITS) {
            try {
                console.log(`🔍 Escaneando r/${subreddit}...`);
                const url = `https://oauth.reddit.com/r/${subreddit}/top?t=day&limit=20`;
                const data = await makeRedditRequest(url);
                
                const posts = data.data.children
                    .filter(post => post.data.num_comments >= MIN_COMMENTS) 
                    .filter(post => !post.data.over_18) 
                    .map(post => ({
                        id: post.data.id,
                        title: post.data.title,
                        subreddit: post.data.subreddit,
                        author: post.data.author,
                        upvotes: post.data.ups,
                        comments: post.data.num_comments,
                        created: post.data.created_utc,
                        url: `https://reddit.com${post.data.permalink}`,
                        external_link_api: post.data.url,
                        image: getPostImage(post.data),
                        video: getPostVideo(post.data),
                        gallery: getPostGallery(post.data),
                        media: getPostMedia(post.data),
                        description: post.data.selftext || '',
                        nsfw: post.data.over_18
                    }));
                
                console.log(`✅ r/${subreddit}: ${posts.length} posts con ≥ ${MIN_COMMENTS} comentarios`);
                allPosts = allPosts.concat(posts);
                
                await new Promise(resolve => setTimeout(resolve, 500));
                
            } catch (error) {
                console.error(`❌ Error en r/${subreddit}:`, error.message);
                continue;
            }
        }
        
        const uniquePosts = allPosts.filter((post, index, self) => 
            index === self.findIndex(p => p.url === post.url)
        ).sort((a, b) => b.comments - a.comments);
        
        console.log(`🎯 Total posts únicos encontrados: ${uniquePosts.length} (≥ ${MIN_COMMENTS} comentarios)`);
        return uniquePosts.slice(0, POST_LIMIT); 
        
    } catch (error) {
        console.error('❌ Error obteniendo posts de tecnología:', error.message);
        throw error;
    }
}

function getPostImage(postData) {
    if (postData.preview && postData.preview.images && postData.preview.images.length > 0) {
        return postData.preview.images[0].source.url.replace(/&amp;/g, '&');
    }
    
    if (postData.url && (
        postData.url.endsWith('.jpg') || postData.url.endsWith('.jpeg') ||
        postData.url.endsWith('.png') || postData.url.endsWith('.gif') ||
        postData.url.includes('imgur.com') || postData.url.includes('i.redd.it')
    )) {
        return postData.url;
    }
    
    if (postData.thumbnail && postData.thumbnail.startsWith('http')) {
        return postData.thumbnail;
    }
    
    return null;
}

function getPostVideo(postData) {
    if (postData.media && postData.media.reddit_video) {
        return postData.media.reddit_video.fallback_url;
    }
    
    if (postData.url && (
        postData.url.includes('youtube.com') || postData.url.includes('youtu.be') ||
        postData.url.includes('vimeo.com') || postData.url.includes('twitch.tv') ||
        postData.url.endsWith('.mp4') || postData.url.endsWith('.webm') ||
        postData.url.includes('gfycat.com') || postData.url.includes('redgifs.com')
    )) {
        return postData.url;
    }
    
    return null;
}

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

function getPostMedia(postData) {
    return {
        image: getPostImage(postData),
        video: getPostVideo(postData),
        gallery: getPostGallery(postData)
    };
}

function hasMediaContent(postData) {
    return !!(postData.image || postData.video || postData.gallery);
}

function getPrimaryMediaUrl(postData) {
    if (postData.video) return postData.video;
    if (postData.image) return postData.image;
    if (postData.gallery && postData.gallery.length > 0) return postData.gallery[0];
    return null;
}

function generateEntityId(redditUrl) {
    return crypto.createHash('sha256')
        .update(redditUrl)
        .digest('hex')
        .substring(0, 24);
}

async function postExists(entityId) {
    const existing = await Post.findOne({ entity: entityId });
    return !!existing;
}

function accumulateProfileChanges(profileId, changes) {
    const current = profileUpdatesMap.get(profileId.toString()) || { likes: 0 };
    profileUpdatesMap.set(profileId.toString(), {
        likes: current.likes + (changes.likes || 0)
    });
}


async function simulatePostLikes(postId, likesCount, allProfiles) {
    const entityId = postId.toString(); 
    const cid = process.env.CID;
    
    if (likesCount <= 0 || allProfiles.length === 0) {
        return [];
    }

    try {
        const profileIdToAuthorMap = new Map(allProfiles.map(p => [p._id.toString(), p.author]));
        
        const shuffledLikerPool = [...allProfiles].sort(() => 0.5 - Math.random());
        const numLikesToCreate = Math.min(likesCount, shuffledLikerPool.length);
        const selectedLikers = shuffledLikerPool.slice(0, numLikesToCreate);
        
        const profileLikeDocs = selectedLikers.map(liker => ({ 
            profile_id: liker._id, 
            fk_id: postId, 
            fk_type: 'post' 
        }));
        
        if (profileLikeDocs.length > 0) {
            await ProfileLike.insertMany(profileLikeDocs);
            console.log(`❤️  ${profileLikeDocs.length} likes simulados para el post ${entityId}`);
            
            // --- REGISTRO DE ESTADÍSTICAS ---
            
            // 1. Registro PUNTUAL DESAGREGADO (PostStats)
            await recordActivityHit(`activity:likes:${cid}`, 'added', entityId);
            // 2. Registro PUNTUAL AGREGADO (Stats)
            await recordActivityHit(`activity:likes:${cid}`, 'added');

            const likerAuthors = selectedLikers.map(l => profileIdToAuthorMap.get(l._id.toString()) || l.author);
            
            await Post.findByIdAndUpdate(postId, {
                $push: { likes: { $each: likerAuthors, $slice: -200 } }
            });
            console.log(`✍️  Añadidos ${likerAuthors.length} autores (hashes) al array de likes del post.`);

            for (const liker of selectedLikers) {
                if (liker && liker.location?.countryCode) {
                    const simulatedReq = simulateRequestFromProfile(liker);
                    if (simulatedReq) {
                        // 3. Registro GEOGRÁFICO DESAGREGADO (GeoPostStats)
                        await recordGeoActivity(simulatedReq, 'like', entityId); 
                        // 4. Registro GEOGRÁFICO AGREGADO (GeoStats)
                        await recordGeoActivity(simulatedReq, 'like');
                    }
                }
            }

            for (const liker of selectedLikers) {
                accumulateProfileChanges(liker._id, { likes: 1 });
            }
            
            return likerAuthors;
        }
        
        return [];
    } catch (error) {
        console.error(`❌ Error simulando likes para post ${entityId}:`, error.message);
        return [];
    }
}

async function importPost(postData, allProfiles) {
    const entityId = generateEntityId(postData.url);
    
    if (await postExists(entityId)) {
        console.log(`⏩ Post ya existe: r/${postData.subreddit} - ${postData.title.substring(0, 60)}...`);
        return { skipped: true, reason: 'exists' };
    }
    
    let finalLink = postData.external_link_api;
    let description = postData.description; 
    
    if (!finalLink || finalLink.includes('reddit.com')) {
        const scrapedLink = await scrapeRedditForExternalLink(postData.url);
        if (scrapedLink) {
            finalLink = scrapedLink;
        } else {
            finalLink = postData.url;
        }
    }

    if (!postData.description && finalLink && !finalLink.includes('reddit.com')) {
        const scrapedDescription = await scrapeWebpage(finalLink);
        description = scrapedDescription || description; 
    }

    if (!hasMediaContent(postData) && finalLink.includes('reddit.com')) {
        console.log(`❌ Post sin multimedia Y sin link externo - SKIPPED: r/${postData.subreddit} - ${postData.title.substring(0, 60)}...`);
        return { skipped: true, reason: 'no_media' };
    }
    
    try {
        const primaryMedia = getPrimaryMediaUrl(postData);
        
        const post = new Post({
            cid: process.env.CID || 'QU-ME7HF2BN-E8QD9',
            entity: entityId,
            reference: postData.url,
            title: postData.title.substring(0, 100),
            description: description.substring(0, 200) || '',
            type: 'reddit_tech',
            link: finalLink,
            image: primaryMedia, 
            media: postData.media, 
            likesCount: postData.upvotes,
            commentCount: postData.comments,
            viewsCount: 0, 
            created_at: new Date(postData.created * 1000),
            updated_at: new Date(postData.created * 1000),
            metadata: {
                subreddit: postData.subreddit,
                author: postData.author,
                nsfw: postData.nsfw,
                original_comments: postData.comments,
                imported_comments: false,
                reddit_permalink: postData.url, 
                has_image: !!postData.image,
                has_video: !!postData.video,
                has_gallery: !!postData.gallery,
                media_count: postData.gallery ? postData.gallery.length : 0
            }
        });
        
        await post.save();
        console.log(`✅ Post importado: r/${postData.subreddit} (Link: ${finalLink.substring(0, 40)}...)`);
        
        if (postData.upvotes > 0 && allProfiles.length > 0) {
            await simulatePostLikes(post._id, postData.upvotes, allProfiles);
        }
        
        return { success: true, post };
    } catch (error) {
        console.error(`❌ Error importando post:`, error.message);
        return { error: true };
    }
}

async function runImportProcess() {
    let exitCode = 0;
    try {
        if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) {
            throw new Error('❌ Credenciales de Reddit no configuradas en .env');
        }
        
        await connectDB();
        console.log('✅ Conectado a la base de datos');
        
        console.log('👤 Obteniendo IDs, Autores y Ubicación de perfiles para simulación...');
        const allProfiles = await Profile.find({}, '_id author location simulatedIp').lean(); 
        console.log(`👍 Encontrados ${allProfiles.length} perfiles para usar como votantes.`);
        
        if (allProfiles.length === 0) {
            console.warn('⚠️ No hay perfiles creados para simular actividad.');
        }

        const techPosts = await fetchTechPostsWithComments();
        
        console.log(`\n📥 Analizando y filtrando posts para importar...`);
        
        let imported = 0;
        let skippedExists = 0;
        let skippedNoMedia = 0;
        let errors = 0;
        
        for (const post of techPosts) {
            const result = await importPost(post, allProfiles);
            
            if (result.skipped) {
                if (result.reason === 'no_media') {
                    skippedNoMedia++;
                } else {
                    skippedExists++;
                }
            } else if (result.success) {
                imported++;
            } else {
                errors++;
            }
            
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        await bulkUpdateProfileCounters(); 
        
        console.log(`\n🎉 Importación completada:`);
        console.log(`   ✅ Nuevos posts: ${imported}`);
        console.log(`   ⏩ Ya existían: ${skippedExists}`);
        console.log(`   🚫 Sin link útil/media (omitidos): ${skippedNoMedia}`);
        console.log(`   ❌ Errores: ${errors}`);
        console.log(`   📊 Total analizados: ${techPosts.length}`);
        
    } catch (error) {
        console.error('❌ Error en importación:', error.message);
        exitCode = 1;
    } finally {
        await mongoose.connection.close();
        console.log('✅ Conexión cerrada');
        return exitCode;
    }
}

async function main() {
    console.log('🚀 Iniciando importación de posts de tecnología...');
    console.log(`⏰ Hora de inicio: ${new Date().toISOString()}`);
    
    const exitCode = await runImportProcess();
    
    console.log(`\n🎉 Proceso finalizado.`);
    process.exit(exitCode);
}

async function scheduledExecution() {
    const INTERVAL_MS = 60 * 60 * 1000; 
    console.log(`\n⏰ Iniciando ciclo de ejecución programada (cada ${INTERVAL_MS / 1000 / 60} minutos)...`);

    const executeCycle = async () => {
        console.log(`\n--- Ejecución de importación de posts ---`);
        console.log(`⏰ Hora de inicio: ${new Date().toISOString()}`);
        
        const exitCode = await runImportProcess(); 
        
        const nextRun = new Date(Date.now() + INTERVAL_MS);
        console.log(`⏭️  Próxima ejecución: ${nextRun.toISOString()}`);
        
        setTimeout(executeCycle, INTERVAL_MS);
    };
    
    executeCycle();
}

if (require.main === module) {
    if (process.argv.includes('--scheduled')) {
        scheduledExecution();
    } else {
        main().catch(console.error);
    }
}

module.exports = { 
    runImportProcess, 
    main, 
    scheduledExecution 
};