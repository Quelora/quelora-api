// SeedRedditThread.js - Versión optimizada para primer nivel
// USO: CID="QU-ME7MZ3WI-3CUPR" REDDIT_URL=https://reddit.com/r/worldnews/comments/1hd8u5q/javier_milei_ends_budget_deficit_in_argentina/ node SeedRedditThread.js
require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const connectDB = require('../db');
const Profile = require('../models/Profile');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const crypto = require('crypto');
const axios = require('axios');

const REDDIT_THREAD_URL = process.env.REDDIT_URL;
const REDDIT_LIMIT = process.env.REDDIT_LIMIT || 1000;
const REDDIT_CLIENT_ID = process.env.REDDIT_CLIENT_ID;
const REDDIT_CLIENT_SECRET = process.env.REDDIT_CLIENT_SECRET;

// Sets para almacenar IDs de comentarios procesados, autores únicos y nombres válidos
const uniqueAuthors = new Set();
const usedValidNames = new Set();

// Lista de ciudades para asignar ubicaciones realistas
const CITIES = [
  { name: "New York", coords: [-74.0060, 40.7128] },
  { name: "Los Angeles", coords: [-118.2437, 34.0522] },
  { name: "Chicago", coords: [-87.6298, 41.8781] },
  { name: "San Francisco", coords: [-122.4194, 37.7749] },
  { name: "Seattle", coords: [-122.3321, 47.6062] },
  { name: "Austin", coords: [-97.7431, 30.2672] },
  { name: "Miami", coords: [-80.1918, 25.7617] },
  { name: "London", coords: [-0.1278, 51.5074] },
  { name: "Berlin", coords: [13.4050, 52.5200] },
  { name: "Tokyo", coords: [139.6917, 35.6895] }
];

// Variable para almacenar el token de acceso
let accessToken = null;

// Configuración de timeouts y límites
const TIMEOUT_MS = 15000;
const BATCH_SIZE = 20;

/**
 * Obtiene token de acceso OAuth2 de Reddit
 */
async function getRedditAccessToken() {
  try {
    console.log('🔑 Obteniendo token de acceso de Reddit...');
    
    const auth = Buffer.from(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`).toString('base64');
    
    const response = await axios.post('https://www.reddit.com/api/v1/access_token',
      'grant_type=client_credentials',
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Quelora-Seeder/1.1'
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
async function makeAuthenticatedRedditRequest(url) {
  if (!accessToken) {
    await getRedditAccessToken();
  }

  try {
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'User-Agent': 'Quelora-Seeder/1.1'
      },
      timeout: TIMEOUT_MS
    });
    
    return response.data;
    
  } catch (error) {
    if (error.response?.status === 401) {
      console.log('🔄 Token expirado, obteniendo nuevo token...');
      await getRedditAccessToken();
      return makeAuthenticatedRedditRequest(url);
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
  return [
    parseFloat((lon + lonOffset).toFixed(6)),
    parseFloat((lat + latOffset).toFixed(6))
  ];
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
  
  let finalName = validName;
  let counter = 1;
  
  while (usedValidNames.has(finalName)) {
    finalName = `${validName}${counter}`;
    counter++;
    if (finalName.length > 15) {
      finalName = finalName.substring(0, 15);
    }
  }
  
  usedValidNames.add(finalName);
  return finalName;
};

/**
 * Obtiene datos del hilo de Reddit (solo comentarios de primer nivel)
 */
async function fetchRedditData(threadUrl, limit = 100) {
  try {
    const threadMatch = threadUrl.match(/comments\/([a-z0-9]+)/i);
    if (!threadMatch) throw new Error('URL de Reddit inválida');
    
    const threadId = threadMatch[1];
    const subreddit = threadUrl.split('/r/')[1].split('/')[0];
    
    const apiUrl = `https://oauth.reddit.com/r/${subreddit}/comments/${threadId}.json?limit=${limit}&depth=1`;
    
    console.log(`📡 Obteniendo datos de: ${apiUrl}`);
    
    const response = await makeAuthenticatedRedditRequest(apiUrl);

    const [postData, commentsData] = response;
    const post = postData.data.children[0].data;
    const comments = commentsData.data.children;

    console.log(`📦 Total de comentarios de primer nivel obtenidos: ${comments.length}`);

    // Filtrar solo comentarios de primer nivel y eliminar [deleted]/[removed]
    const filteredComments = comments
      .filter(comment => comment.kind === 't1')
      .map(comment => comment.data)
      .filter(comment => 
        comment.author !== '[deleted]' && 
        comment.body !== '[deleted]' &&
        comment.body !== '[removed]' &&
        comment.author &&
        comment.body
      );

    console.log(`✅ Comentarios válidos después de filtrar: ${filteredComments.length}`);

    return {
      post: {
        title: post.title,
        content: post.selftext || '',
        upvotes: post.ups,
        downvotes: post.downs,
        comments: post.num_comments,
        created: post.created_utc,
        author: post.author,
        url: `https://reddit.com${post.permalink}`
      },
      comments: filteredComments
    };

  } catch (error) {
    console.error('❌ Error obteniendo datos de Reddit:', error.message);
    throw error;
  }
}

/**
 * Crea o obtiene un perfil para un autor de Reddit
 */
async function getOrCreateProfile(redditAuthor) {
  const validName = generateValidName(redditAuthor);
  const existingProfile = await Profile.findOne({ name: validName }).maxTimeMS(TIMEOUT_MS);
  if (existingProfile) {
    console.log(`✅ Perfil existente: ${validName}`);
    uniqueAuthors.add(redditAuthor);
    return existingProfile;
  }

  uniqueAuthors.add(redditAuthor);
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
      notifications: {
        web: false,
        email: false,
        push: false,
        newFollowers: false,
        postLikes: false,
        comments: false,
        newPost: false
      },
      privacy: {
        followerApproval: false,
        showActivity: 'everyone'
      },
      interface: {
        defaultLanguage: 'en',
        defaultTheme: 'system'
      },
      session: {
        rememberSession: true
      }
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
    throw error;
  }
}

/**
 * Crea o encuentra el post principal
 */
async function createOrFindPost(redditData, entityId) {
  const existingPost = await Post.findOne({ entity: entityId }).maxTimeMS(TIMEOUT_MS);
  if (existingPost) {
    console.log(`✅ Post existente: ${existingPost._id}`);
    return existingPost;
  }

  const postData = {
    cid: process.env.CID || 'QU-ME7HF2BN-E8QD9',
    entity: entityId,
    reference: redditData.post.url,
    title: redditData.post.title.substring(0, 100),
    description: (redditData.post.content || '').substring(0, 200),
    type: 'reddit_crosspost',
    link: redditData.post.url,
    likesCount: redditData.post.upvotes || 0,
    commentCount: redditData.post.comments || 0,
    viewsCount: Math.floor((redditData.post.upvotes || 0) * 15),
    created_at: new Date((redditData.post.created || Date.now() / 1000) * 1000),
    updated_at: new Date((redditData.post.created || Date.now() / 1000) * 1000)
  };

  try {
    const post = new Post(postData);
    await post.save();
    console.log(`✅ Post creado: ${post._id}`);
    return post;
  } catch (error) {
    console.error(`❌ Error creando post:`, error.message);
    throw error;
  }
}

/**
 * Crea comentarios de forma controlada con límite de concurrencia
 */
async function createComments(comments, postId, entityId) {
    // FILTRAR primero los comentarios válidos
    const validComments = comments.filter(comment => 
        comment && comment.author && comment.body && typeof comment.body === 'string'
    );

    const createdComments = [];
    let processed = 0;
    const total = validComments.length; // ← Usar el total de comentarios VÁLIDOS

    console.log(`⏳ Creando ${total} comentarios válidos de ${comments.length} totales...`);

    for (let i = 0; i < validComments.length; i += BATCH_SIZE) {
        const batch = validComments.slice(i, i + BATCH_SIZE);
        const batchPromises = [];

        for (const commentData of batch) {
            batchPromises.push((async () => {
                try {
                    const profile = await getOrCreateProfile(commentData.author);
                    
                    const existingComment = await Comment.findOne({
                        post: postId,
                        profile_id: profile._id,
                        text: commentData.body.substring(0, 1000)
                    }).maxTimeMS(TIMEOUT_MS);

                    if (existingComment) {
                        console.log(`⏩ Comentario duplicado saltado: ${commentData.body.substring(0, 30)}...`);
                        return null;
                    }

                    const comment = new Comment({
                        post: postId,
                        entity: entityId,
                        parent: null,
                        profile_id: profile._id,
                        author: profile.author,
                        text: commentData.body.substring(0, 1000),
                        language: 'en',
                        likesCount: commentData.upvotes || 0,
                        created_at: new Date((commentData.created_utc || Date.now() / 1000) * 1000),
                        updated_at: new Date((commentData.created_utc || Date.now() / 1000) * 1000)
                    });

                    await comment.save();
                    processed++;
                    console.log(`✅ Comentario ${processed}/${total} creado: ${commentData.author} - "${commentData.body.substring(0, 30)}..."`);
                    return comment;

                } catch (error) {
                    console.error(`❌ Error con comentario de ${commentData.author}:`, error.message);
                    return null;
                }
            })());
        }

        try {
            const batchResults = await Promise.allSettled(batchPromises);
            const successfulComments = batchResults
                .filter(result => result.status === 'fulfilled' && result.value !== null)
                .map(result => result.value);
            
            createdComments.push(...successfulComments);
            
        } catch (batchError) {
            console.error('❌ Error en lote de comentarios:', batchError.message);
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    return createdComments;
}


/**
 * Función principal para seedear el hilo de Reddit
 */
async function seedRedditThread() {
  let connectionClosed = false;
  try {
    if (!REDDIT_THREAD_URL) {
      throw new Error('❌ REDDIT_URL no definido en variables de entorno');
    }

    if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) {
      throw new Error('❌ Credenciales de Reddit no configuradas en .env');
    }

    console.log('⏳ Conectando a la base de datos...');
    await connectDB();
    console.log('✅ Conexión a la base de datos establecida');

    console.log('⏳ Autenticando con Reddit API...');
    await getRedditAccessToken();

    const entityId = generateEntityId(REDDIT_THREAD_URL);

    console.log('⏳ Obteniendo datos de Reddit (solo primer nivel)...');
    const redditData = await fetchRedditData(REDDIT_THREAD_URL, REDDIT_LIMIT);

    console.log('✅ Datos obtenidos:');
    console.log(`   - Post: ${redditData.post.title}`);
    console.log(`   - ${redditData.comments.length} comentarios válidos de primer nivel`);
    console.log(`   - Autor original: ${redditData.post.author}`);

    console.log('⏳ Verificando/creando post...');
    const post = await createOrFindPost(redditData, entityId);

    console.log('⏳ Creando comentarios...');
    const allComments = await createComments(redditData.comments, post._id, entityId);

    console.log('⏳ Actualizando conteo de comentarios en el post...');
    await Post.findByIdAndUpdate(post._id, {
      commentCount: allComments.length,
      updated_at: new Date()
    });

    console.log('🎉 Hilo de Reddit importado exitosamente!');
    console.log(`   - Post: ${post._id}`);
    console.log(`   - Total comentarios creados: ${allComments.length}`);
    console.log(`   - Perfiles únicos: ${uniqueAuthors.size}`);

  } catch (err) {
    console.error('❌ Error en el seed:', err.message);
    process.exitCode = 1;
  } finally {
    if (!connectionClosed) {
      console.log('⏳ Cerrando conexión a la base de datos...');
      try {
        await mongoose.connection.close();
        console.log('✅ Conexión a la base de datos cerrada');
        connectionClosed = true;
      } catch (closeError) {
        console.error('❌ Error al cerrar la conexión a la base de datos:', closeError.message);
        process.exitCode = 1;
      }
    }
    console.log('🏁 Finalizando ejecución del script');
    process.exit(process.exitCode || 0);
  }
}

// Ejecutar el script
console.log('🚀 Iniciando seedRedditThread (solo primer nivel)...');
seedRedditThread();