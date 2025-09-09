// SeedRedditThread.js
// USO: CID="QU-ME7HF2BN-E8QD9" REDDIT_URL=<url_del_hilo> node SeedRedditThread.js
// CID="QU-ME7HF2BN-E8QD9" REDDIT_URL="https://www.reddit.com/r/worldnews/comments/1hd8u5q/javier_milei_ends_budget_deficit_in_argentina/" node SeedRedditThread.js
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

// Sets para almacenar IDs de comentarios procesados, autores únicos y nombres válidos
const processedCommentIds = new Set();
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
 * Obtiene recursivamente todos los comentarios que faltan (objetos "more")
 */
async function fetchAllMissingComments(commentThings, linkId) {
  const comments = commentThings.filter(c => c.kind === 't1' && !processedCommentIds.has(c.data.id)).map(c => {
    processedCommentIds.add(c.data.id);
    return c.data;
  });
  const moreObjects = commentThings.filter(c => c.kind === 'more');

  if (moreObjects.length === 0) {
    return comments;
  }

  const moreIds = moreObjects.flatMap(more => more.data.children).filter(id => !processedCommentIds.has(id));
  console.log(`🔍 Encontrados ${moreIds.length} IDs de comentarios adicionales para obtener...`);

  if (moreIds.length === 0) {
    return comments;
  }

  const newCommentThings = [];
  const BATCH_SIZE_MORE = 100;

  for (let i = 0; i < moreIds.length; i += BATCH_SIZE_MORE) {
    const batch = moreIds.slice(i, i + BATCH_SIZE_MORE);
    const moreChildrenUrl = `https://www.reddit.com/api/morechildren.json?api_type=json&link_id=${linkId}&children=${batch.join(',')}`;
    
    try {
      const response = await axios.get(moreChildrenUrl, {
        headers: { 'User-Agent': 'Quelora-Seeder/1.1' },
        timeout: 30000
      });
      if (response.data.json && response.data.json.data && response.data.json.data.things) {
        newCommentThings.push(...response.data.json.data.things);
      }
    } catch (error) {
      console.error(`❌ Error obteniendo lote de comentarios adicionales: ${error.message}`);
    }
  }

  const fetchedNewComments = await fetchAllMissingComments(newCommentThings, linkId);
  return comments.concat(fetchedNewComments);
}

/**
 * Obtiene datos del hilo de Reddit
 */
async function fetchRedditData(threadUrl, limit = 1000) {
  try {
    const threadMatch = threadUrl.match(/comments\/([a-z0-9]+)/i);
    if (!threadMatch) throw new Error('URL de Reddit inválida');
    
    const threadId = threadMatch[1];
    const subreddit = threadUrl.split('/r/')[1].split('/')[0];
    
    const apiUrl = `https://www.reddit.com/r/${subreddit}/comments/${threadId}.json?limit=${limit}&depth=10`;
    
    console.log(`📡 Obteniendo datos iniciales de: ${apiUrl}`);
    
    const response = await axios.get(apiUrl, {
      headers: { 'User-Agent': 'Quelora-Seeder/1.1' },
      timeout: 30000
    });

    const [postData, commentsData] = response.data;
    const post = postData.data.children[0].data;
    const initialCommentThings = commentsData.data.children;

    console.log('✅ Datos iniciales obtenidos. Expandiendo todos los comentarios...');
    processedCommentIds.clear(); // Limpiar el Set para esta nueva ejecución
    const allComments = await fetchAllMissingComments(initialCommentThings, post.name);
    
    console.log(`📦 Total de comentarios obtenidos después de expandir: ${allComments.length}`);

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
      comments: processCommentsTree(allComments)
    };

  } catch (error) {
    console.error('❌ Error obteniendo datos de Reddit:', error.message);
    throw error;
  }
}

/**
 * Procesa los comentarios en estructura de árbol, manejando comentarios huérfanos
 */
function processCommentsTree(comments) {
  const commentMap = new Map();
  const rootComments = [];
  const orphanedComments = []; // Almacena comentarios cuyos padres no se han encontrado aún

  // Paso 1: Mapear todos los comentarios por su ID
  comments.forEach(comment => {
    if (!comment || !comment.id) return;
    
    commentMap.set(comment.id, {
      id: comment.id,
      author: comment.author || 'unknown',
      text: comment.body || '',
      upvotes: comment.ups || 0,
      downvotes: comment.downs || 0,
      created: comment.created_utc || Date.now() / 1000,
      parent_id: comment.parent_id,
      replies: []
    });
  });

  // Paso 2: Construir el árbol inicial
  commentMap.forEach(comment => {
    if (comment.parent_id && comment.parent_id.startsWith('t3_')) {
      rootComments.push(comment);
    } else if (comment.parent_id && comment.parent_id.startsWith('t1_')) {
      const parentId = comment.parent_id.substring(3);
      const parentComment = commentMap.get(parentId);
      if (parentComment) {
        parentComment.replies.push(comment);
      } else {
        orphanedComments.push(comment); // Guardar comentarios huérfanos
      }
    }
  });

  // Paso 3: Reintentar anidar comentarios huérfanos
  let attempts = 0;
  const maxAttempts = 5; // Evitar bucles infinitos
  while (orphanedComments.length > 0 && attempts < maxAttempts) {
    const stillOrphaned = [];
    orphanedComments.forEach(comment => {
      if (comment.parent_id && comment.parent_id.startsWith('t1_')) {
        const parentId = comment.parent_id.substring(3);
        const parentComment = commentMap.get(parentId);
        if (parentComment) {
          parentComment.replies.push(comment);
        } else {
          stillOrphaned.push(comment);
        }
      }
    });
    orphanedComments.length = 0;
    orphanedComments.push(...stillOrphaned);
    attempts++;
  }

  // Paso 4: Tratar los comentarios huérfanos restantes como raíz
  if (orphanedComments.length > 0) {
    console.log(`⚠️ ${orphanedComments.length} comentarios huérfanos tratados como raíz`);
    rootComments.push(...orphanedComments);
  }

  return rootComments;
}

/**
 * Crea o obtiene un perfil para un autor de Reddit
 */
async function getOrCreateProfile(redditAuthor) {
  const validName = generateValidName(redditAuthor);
  const existingProfile = await Profile.findOne({ name: validName });
  if (existingProfile) {
    console.log(`✅ Perfil existente encontrado: ${validName} (${redditAuthor})`);
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
    picture: `https://www.redditstatic.com/avatars/defaults/v2/avatar_default_${Math.floor(Math.random() * 8)}.png`,
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
    console.log(`✅ Perfil creado: ${validName} (${redditAuthor})`);
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
  const existingPost = await Post.findOne({ entity: entityId });
  if (existingPost) {
    console.log(`✅ Post existente encontrado: ${existingPost._id}`);
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
 * Crea comentarios de forma recursiva, evitando duplicados
 */
async function createCommentsRecursive(comments, postId, entityId, parentId = null) {
  const createdComments = [];

  for (const commentData of comments) {
    try {
      if (!commentData.author || !commentData.text) {
        console.log(`⚠️ Comentario sin autor o texto, saltando: ${commentData.id}`);
        continue;
      }

      const profile = await getOrCreateProfile(commentData.author);
      
      // Verificar si ya existe un comentario con el mismo texto y autor
      const existingComment = await Comment.findOne({
        post: postId,
        profile_id: profile._id,
        text: commentData.text.substring(0, 1000)
      });

      if (existingComment) {
        console.log(`✅ Comentario existente encontrado para ${commentData.author}: ${commentData.text.substring(0, 50)}...`);
        if (commentData.replies && commentData.replies.length > 0) {
          const replies = await createCommentsRecursive(
            commentData.replies,
            postId,
            entityId,
            existingComment._id
          );
          createdComments.push(...replies);
        }
        continue;
      }

      const comment = new Comment({
        post: postId,
        entity: entityId,
        parent: parentId,
        profile_id: profile._id,
        author: profile.author,
        text: commentData.text.substring(0, 1000),
        language: 'en',
        likesCount: commentData.upvotes || 0,
        created_at: new Date((commentData.created || Date.now() / 1000) * 1000),
        updated_at: new Date((commentData.created || Date.now() / 1000) * 1000)
      });

      await comment.save();
      console.log(`✅ Comentario creado para ${commentData.author}: ${commentData.text.substring(0, 50)}...`);
      createdComments.push(comment);

      if (commentData.replies && commentData.replies.length > 0) {
        const replies = await createCommentsRecursive(
          commentData.replies,
          postId,
          entityId,
          comment._id
        );
        createdComments.push(...replies);
      }

    } catch (error) {
      console.error(`❌ Error creando comentario para ${commentData.author}:`, error.message);
    }
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

    console.log('⏳ Conectando a la base de datos...');
    await connectDB();
    console.log('✅ Conexión a la base de datos establecida');

    const entityId = generateEntityId(REDDIT_THREAD_URL);

    console.log('⏳ Obteniendo datos de Reddit...');
    const redditData = await fetchRedditData(REDDIT_THREAD_URL, REDDIT_LIMIT);

    console.log('✅ Datos obtenidos:');
    console.log(`   - Post: ${redditData.post.title}`);
    console.log(`   - ${redditData.comments.length} comentarios raíz (después de expandir)`);
    console.log(`   - Autor original: ${redditData.post.author}`);

    console.log('⏳ Verificando/creando post...');
    const post = await createOrFindPost(redditData, entityId);

    console.log('⏳ Creando comentarios...');
    const allComments = await createCommentsRecursive(redditData.comments, post._id, entityId);

    console.log('⏳ Actualizando conteo de comentarios en el post...');
    await Post.findByIdAndUpdate(post._id, {
      commentCount: allComments.length,
      updated_at: new Date()
    });

    console.log('🎉 Hilo de Reddit importado exitosamente!');
    console.log(`   - Post: ${post._id}`);
    console.log(`   - Total comentarios: ${allComments.length}`);
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
console.log('🚀 Iniciando seedRedditThread...');
seedRedditThread();