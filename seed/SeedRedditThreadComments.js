// SeedRedditThreadComments.js - Versión 2.7
// USO: CID="QU-ME7HF2BN-E8QD9" REDDIT_URL="https://www.reddit.com/r/PeterExplainsTheJoke/comments/1nfvack/peter_is_this_ai_whats_this_bird/" node SeedRedditThreadComments.js
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

const REDDIT_THREAD_ENTITY 	= process.env.REDDIT_ENTITY;
const REDDIT_THREAD_URL = process.env.REDDIT_URL;
const REDDIT_LIMIT = process.env.REDDIT_LIMIT || 1000;
const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID;
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET;

// Sets para optimización
const uniqueAuthors = new Set();
const usedValidNames = new Set();
const authorToNameMap = new Map();

// --- ESTRATEGIA DE BATCHING PARA CONTADORES DE PERFILES ---
const profileUpdatesMap = new Map(); // Mapa para acumular { profileId: { comments: N, likes: M } }
const TIMEOUT_MS = 25000;
const MORE_COMMENTS_BATCH_SIZE = 100;
// -----------------------------------------------------------

// Datos para perfiles sintéticos
const CITIES = [
	{ name: "New York", coords: [-74.0060, 40.7128] },
	{ name: "Los Angeles", coords: [-118.2437, 34.0522] },
	{ name: "Chicago", coords: [-87.6298, 41.8781] },
	{ name: "London", coords: [-0.1278, 51.5074] },
	{ name: "Berlin", coords: [13.4050, 52.5200] },
	{ name: "Tokyo", coords: [139.6917, 35.6895] }
];

let accessToken = null;

// --- FUNCIONES DE AUTENTICACIÓN Y REDDIT ---

async function getRedditAccessToken() {
	try {
		console.log('🔑 Obteniendo token de acceso de Reddit...');
		const auth = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64');
		const response = await axios.post('https://www.reddit.com/api/v1/access_token', 'grant_type=client_credentials', {
			headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Quelora-Seeder/2.6' },
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
		const config = { method, url, headers: { 'Authorization': `Bearer ${accessToken}`, 'User-Agent': 'Quelora-Seeder/2.6' }, timeout: TIMEOUT_MS };
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

// --- FUNCIONES AUXILIARES ---

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

async function scrapeWebpage(url) {
	try {
		console.log(`🌐 Scrapeando página web: ${url}`);
		const { data } = await axios.get(url, { headers: { 'User-Agent': 'Quelora-Seeder/2.6' }, timeout: TIMEOUT_MS });
		const $ = cheerio.load(data);
		let description = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '';
		let image = $('meta[property="og:image"]').attr('content') || $('article img').first().attr('src') || null;
		if (image && !image.startsWith('http')) image = new URL(image, new URL(url).origin).href;
		return { description: decodeHtmlEntities(description), image: decodeHtmlEntities(image) };
	} catch (error) {
		console.error(`❌ Error scrapeando ${url}:`, error.message);
		return { description: '', image: null };
	}
}

/**
 * Acumula los incrementos en memoria para realizar una actualización eficiente en lote al final.
 */
function accumulateProfileChanges(profileId, changes) {
	const current = profileUpdatesMap.get(profileId.toString()) || { comments: 0, likes: 0 };
	profileUpdatesMap.set(profileId.toString(), {
		comments: current.comments + (changes.comments || 0),
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

// --- LÓGICA PRINCIPAL DE SEEDING ---

async function fetchRedditData(threadUrl, limit = 1000) {
	const threadMatch = threadUrl.match(/comments\/([a-z0-9]+)/i);
	if (!threadMatch) throw new Error('URL de Reddit inválida');
	const threadId = threadMatch[1];
	const subreddit = threadUrl.split('/r/')[1].split('/')[0];
	const apiUrl = `https://oauth.reddit.com/r/${subreddit}/comments/${threadId}.json?limit=${limit}&threaded=true&sort=top`;
	console.log(`📡 Obteniendo datos iniciales de: ${apiUrl}`);
	const [postData, commentsData] = await makeAuthenticatedRedditRequest(apiUrl);
	const post = postData.data.children[0].data;
	const comments = commentsData.data.children;
	let imageUrl = null;
	if (post.preview?.images?.[0]) imageUrl = decodeHtmlEntities(post.preview.images[0].source.url);
	else if (post.url && /\.(jpg|png|gif)$/.test(post.url)) imageUrl = decodeHtmlEntities(post.url);
	else if (post.url_overridden_by_dest && /\.(jpg|png|gif)$/.test(post.url_overridden_by_dest)) imageUrl = decodeHtmlEntities(post.url_overridden_by_dest);
	let description = post.selftext || '';
	if (!description && post.url && !post.is_self && post.url.startsWith('http')) {
		const scrapedData = await scrapeWebpage(post.url);
		description = scrapedData.description || '';
		if (!imageUrl) imageUrl = scrapedData.image || null;
	}
	return {
		post: {
			title: post.title,
			description,
			upvotes: post.ups,
			comments: post.num_comments,
			created: post.created_utc,
			url: `https://reddit.com${post.permalink}`,
			image: imageUrl,
		},
		comments: comments.filter(c => c.kind === 't1'),
		moreComments: comments.filter(c => c.kind === 'more').flatMap(more => more.data.children)
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
	const city = CITIES[Math.floor(Math.random() * CITIES.length)];
	const coordinates = generateRandomCoords(city.coords);

	// Crear perfil usando el schema detallado.
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
			city: city.name,
			countryCode: 'US',
			regionCode: 'CA',
			lastUpdated: new Date(),
			source: 'geocoding'
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
		console.log(`✅ Perfil creado: ${validName}`);
		return profile;
	} catch (error) {
		console.error(`❌ Error creando perfil para ${redditAuthor}:`, error.message);
		return null;
	}
}

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
		cid: process.env.CID || 'QU-ME7HF2BN-E8QD9',
		entity: entityId,
		reference: redditData.post.url,
		title: redditData.post.title.substring(0, 100),
		description: redditData.post.description,
		type: 'reddit_crosspost',
		link: redditData.post.url,
		image: redditData.post.image,
		likes: [], // Iniciar array de likes vacío (para likes del post)
		likesCount: redditData.post.upvotes || 0,
		commentCount: redditData.post.comments || 0,
		viewsCount: Math.floor((redditData.post.upvotes || 0) * 15),
		created_at: new Date(redditData.post.created * 1000),
		updated_at: new Date(redditData.post.created * 1000),
		moreCommentsRef: moreComments
	};
	post = new Post(postData);
	await post.save();
	console.log(`✅ Post creado: ${post._id}`);
	return post;
}

// CORRECCIÓN: parentId ahora es un parámetro obligatorio con valor por defecto
async function processCommentsRecursively(commentsData, postId, entityId, allProfileIds, parentId = null) {
    let createdCommentsCount = 0;
    const newMoreCommentIds = [];

    // Mapeamos los IDs de MongoDB a sus autores (hashes) para los likers
    const profileIdToAuthorMap = new Map(allProfileIds.map(p => [p._id.toString(), p.author]));

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
                
                // Acumular el conteo de comentarios para el autor
                accumulateProfileChanges(profile._id, { comments: 1 });

                if (likesCount > 0 && allProfileIds.length > 0) {
                    const likerPool = allProfileIds.filter(p => p._id.toString() !== profile._id.toString());
                    if (likerPool.length > 0) {
                        const shuffledLikerPool = likerPool.sort(() => 0.5 - Math.random());
                        const numLikesToCreate = Math.min(likesCount, shuffledLikerPool.length);
                        const selectedLikers = shuffledLikerPool.slice(0, numLikesToCreate);
                        const profileLikeDocs = selectedLikers.map(liker => ({ profile_id: liker._id, fk_id: newComment._id, fk_type: 'comment' }));
                        
                        if (profileLikeDocs.length > 0) {
                            await ProfileLike.insertMany(profileLikeDocs);
                            console.log(`❤️ 	${profileLikeDocs.length} likes simulados para el comentario ${newComment._id}`);
                            
                            // OBTENEMOS EL CAMPO 'author' (HASH) para el array de likes
                            const likerAuthors = selectedLikers.map(l => profileIdToAuthorMap.get(l._id.toString()) || l.author);
                            
                            // SE AÑADEN AL ARRAY DE LIKES DEL COMENTARIO USANDO EL HASH DEL AUTOR
                            await Comment.findByIdAndUpdate(newComment._id, {
                                $push: { likes: { $each: likerAuthors, $slice: -200 } }
                            });
                            console.log(`✍️ 	Añadidos ${likerAuthors.length} autores (hashes) al array de likes del comentario.`);


                            // Acumular conteo de likes para cada votante
                            for (const liker of selectedLikers) {
                                accumulateProfileChanges(liker._id, { likes: 1 });
                            }
                        }
                    }
                }

                if (parentId) await Comment.findByIdAndUpdate(parentId, { $inc: { repliesCount: 1 } });
                
                if (commentData.replies?.data?.children.length > 0) {
                    const { count, moreIds } = await processCommentsRecursively(commentData.replies.data.children, postId, entityId, allProfileIds, newComment._id);
                    createdCommentsCount += count;
                    newMoreCommentIds.push(...moreIds);
                }
            } catch (error) {
                console.error(`❌ Error procesando comentario de ${commentData.author}: parentId is not defined`, error.message);
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
		
		console.log('👤 Obteniendo IDs y Autores de perfiles para simulación de likes...');
		// Se obtiene el author (hash) junto con el _id
		const allProfileIds = await Profile.find({}, '_id author').lean(); 
		console.log(`👍 Encontrados ${allProfileIds.length} perfiles para usar como votantes.`);

		const entityId = REDDIT_THREAD_ENTITY;
		const threadId = REDDIT_THREAD_URL.match(/comments\/([a-z0-9]+)/i)[1];
		let post = await Post.findOne({ entity: entityId });

		if (!post?.metadata?.imported_comments) {
			console.log("⏳ Realizando importación inicial...");
			const redditData = await fetchRedditData(REDDIT_THREAD_URL, REDDIT_LIMIT);
			post = await createOrFindPost(redditData, entityId, redditData.moreComments);
			
			// CORRECCIÓN: Pasar NULL como parentId para los comentarios raíz
			const { count, moreIds } = await processCommentsRecursively(redditData.comments, post._id, entityId, allProfileIds, null);
			
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
				// CORRECCIÓN: Pasar NULL como parentId para los comentarios adicionales de nivel raíz
				const { moreIds } = await processCommentsRecursively(newCommentsData, post._id, entityId, allProfileIds, null); 
				post.moreCommentsRef.push(...moreIds);
				post.moreCommentsRef = [...new Set(post.moreCommentsRef)];
			}
			await Post.findByIdAndUpdate(post._id, { $set: { moreCommentsRef: post.moreCommentsRef } });
			console.log(`📊 moreCommentsRef restantes: ${post.moreCommentsRef.length}`);
			await new Promise(resolve => setTimeout(resolve, 1000));
		}

		// --- PASO CLAVE: ACTUALIZACIÓN FINAL DE CONTADORES ---
		await bulkUpdateProfileCounters(); 
		// ---------------------------------------------------

		console.log('⏳ Actualizando conteo final de comentarios en el post...');
		const finalCommentCount = await Comment.countDocuments({ post: post._id });
		await Post.findByIdAndUpdate(post._id, {
			commentCount: finalCommentCount,
			updated_at: new Date(),
			'metadata.imported_comments': true
		});

		console.log('🎉 Hilo de Reddit importado/actualizado exitosamente!');
	} catch (err) {
		console.error('❌ Error fatal en el seed:', err.message, err.stack);
		exitCode = 1;
	} finally {
		await mongoose.connection.close();
		console.log('✅ Conexión a DB cerrada. Finalizando script.');
		process.exit(exitCode);
	}
}

console.log('🚀 Iniciando seedRedditThread (versión 2.7)...');
seedRedditThread();