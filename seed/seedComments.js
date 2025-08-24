// seedComments.js
// Ejemplo de uso: POST_ID="68a5c8e703d56cbaaabcec5b"  NUM_COMMENTS=115 NUM_WITH_REPLIES=10 node seedComments.js

require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const connectDB = require('../db');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const Profile = require('../models/Profile');

const BATCH_SIZE = 100; // Tamaño de lote para inserciones masivas
const COMMENTS_FILE = path.join(__dirname, 'comments.txt'); // Archivo con comentarios, una línea por comentario
const REPLIES_PER_PARENT = 2; // Número fijo de réplicas por comentario que las tenga (puedes ajustar)

// Variables de entorno
const POST_ID = process.env.POST_ID;
const COMMENT_ID = process.env.COMMENT_ID; // Nuevo parámetro opcional
const NUM_COMMENTS = parseInt(process.env.NUM_COMMENTS) || 10;
const NUM_WITH_REPLIES = parseInt(process.env.NUM_WITH_REPLIES) || 0;

// Validaciones iniciales
if (!POST_ID || !mongoose.Types.ObjectId.isValid(POST_ID)) {
  console.error('❌ Debes proporcionar un POST_ID válido.');
  process.exit(1);
}

if (COMMENT_ID && !mongoose.Types.ObjectId.isValid(COMMENT_ID)) {
  console.error('❌ COMMENT_ID proporcionado no es válido.');
  process.exit(1);
}

if (NUM_COMMENTS < 1 || NUM_WITH_REPLIES > NUM_COMMENTS) {
  console.error('❌ NUM_COMMENTS debe ser al menos 1 y NUM_WITH_REPLIES no puede exceder NUM_COMMENTS.');
  process.exit(1);
}

/**
 * Lee los textos de comentarios de un archivo línea por línea y los mezcla aleatoriamente.
 * @returns {Array<string>} Array con los textos de comentarios únicos.
 */
function readCommentsFromFile() {
  try {
    const data = fs.readFileSync(COMMENTS_FILE, 'utf8');
    let lines = data.split('\n').filter(line => line.trim() !== '');
    
    // Mezclar los comentarios aleatoriamente
    lines = lines.sort(() => Math.random() - 0.5);
    
    // Crear un Set para asegurar unicidad
    const uniqueComments = new Set(lines);
    if (uniqueComments.size < NUM_COMMENTS) {
      throw new Error(`❌ El archivo ${COMMENTS_FILE} no tiene suficientes comentarios únicos (${uniqueComments.size} < ${NUM_COMMENTS}).`);
    }
    
    // Convertir Set a array y tomar solo los necesarios
    return Array.from(uniqueComments).slice(0, NUM_COMMENTS);
  } catch (err) {
    console.error('❌ Error leyendo el archivo de comentarios:', err.message);
    process.exit(1);
  }
}

/**
 * Obtiene perfiles aleatorios de la base de datos.
 * @param {number} count - Número de perfiles a obtener.
 * @returns {Promise<Array<Object>>} Array de perfiles.
 */
async function getRandomProfiles(count) {
  return Profile.aggregate([{ $sample: { size: count } }]);
}

/**
 * Crea un comentario base o réplica.
 * @param {Object} params - Parámetros para el comentario.
 * @returns {Object} Objeto comentario listo para insertar.
 */
function createComment(params) {
  const { post, entity, parent = null, profile, text } = params;
  const now = new Date();
  return {
    post,
    entity,
    parent,
    profile_id: profile._id,
    author: profile.author || profile.name,
    text,
    language: 'es',
    likes: [],
    repliesCount: 0,
    likesCount: 0,
    visible: true,
    translates: [],
    hasAudio: false,
    created_at: now,
    updated_at: now,
  };
}

/**
 * Función principal para sembrar comentarios.
 */
async function seedComments() {
  try {
    await connectDB();
    console.log('⏳ Conectado a la base de datos.');

    // Obtener el post y su entity
    const post = await Post.findById(POST_ID);
    if (!post) {
      throw new Error('❌ Post no encontrado.');
    }
    const entity = post.entity;

    // Validar COMMENT_ID si se proporciona
    let parentComment = null;
    if (COMMENT_ID) {
      parentComment = await Comment.findById(COMMENT_ID);
      if (!parentComment) {
        throw new Error('❌ Comentario padre no encontrado.');
      }
      if (!parentComment.post.equals(post._id)) {
        throw new Error('❌ El COMMENT_ID no pertenece al POST_ID proporcionado.');
      }
    }

    // Leer textos de comentarios
    const commentTexts = readCommentsFromFile();
    console.log(`✅ Leídos ${commentTexts.length} textos de comentarios únicos.`);

    // Obtener perfiles random (uno por comentario base + réplicas si no hay COMMENT_ID)
    const totalProfilesNeeded = NUM_COMMENTS + (parentComment ? 0 : NUM_WITH_REPLIES * REPLIES_PER_PARENT);
    const profiles = await getRandomProfiles(totalProfilesNeeded);
    if (profiles.length < totalProfilesNeeded) {
      throw new Error(`❌ No hay suficientes perfiles disponibles (${profiles.length} < ${totalProfilesNeeded}).`);
    }
    console.log(`✅ Obtenidos ${profiles.length} perfiles aleatorios.`);

    let profileIndex = 0;
    const usedComments = new Set(); // Seguimiento de comentarios usados

    // Crear comentarios (réplicas si COMMENT_ID está presente, base si no)
    const baseComments = [];
    for (let i = 0; i < NUM_COMMENTS; i += BATCH_SIZE) {
      const batchSize = Math.min(BATCH_SIZE, NUM_COMMENTS - i);
      const batch = [];
      for (let j = 0; j < batchSize; j++) {
        let text = commentTexts[i + j];
        
        // Verificar que el comentario no se haya usado
        if (usedComments.has(text)) {
          throw new Error(`❌ Comentario duplicado detectado: ${text}`);
        }
        usedComments.add(text);

        const profile = profiles[profileIndex++];
        batch.push(createComment({
          post: post._id,
          entity,
          parent: parentComment ? parentComment._id : null,
          profile,
          text
        }));
      }
      const inserted = await Comment.insertMany(batch);
      baseComments.push(...inserted);
      // Incrementar contadores
      for (let j = 0; j < batchSize; j++) {
        await Post.incrementComment(post._id);
        if (parentComment) {
          await Comment.incrementReplies(parentComment._id);
        }
      }
      console.log(`✅ Insertados ${i + batch.length} comentarios...`);
    }

    // Agregar réplicas si no se proporcionó COMMENT_ID
    if (!parentComment && NUM_WITH_REPLIES > 0) {
      const parents = baseComments.sort(() => 0.5 - Math.random()).slice(0, NUM_WITH_REPLIES);
      console.log(`⏳ Agregando réplicas a ${parents.length} comentarios...`);

      for (const parent of parents) {
        for (let k = 0; k < REPLIES_PER_PARENT; k++) {
          // Generar un texto de réplica único
          const text = `Réplica ${k + 1} a: ${parent.text.slice(0, 20)}...`;
          if (usedComments.has(text)) {
            throw new Error(`❌ Texto de réplica duplicado detectado: ${text}`);
          }
          usedComments.add(text);

          const profile = profiles[profileIndex++];
          const reply = await Comment.create(createComment({
            post: post._id,
            entity,
            parent: parent._id,
            profile,
            text
          }));
          await Comment.incrementReplies(parent._id);
          await Post.incrementComment(post._id); // Réplicas también cuentan como comentarios del post
          console.log(`✅ Agregada réplica al comentario ${parent._id}`);
        }
      }
    }

    console.log('🎉 Todos los comentarios y réplicas han sido insertados exitosamente.');
  } catch (err) {
    console.error('❌ Error durante la siembra:', err.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

seedComments();