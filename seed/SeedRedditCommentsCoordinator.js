// SeedRedditCommentsCoordinator.js - Coordinador de importación de comentarios
// USO: node SeedRedditCommentsCoordinator.js
// node SeedRedditCommentsCoordinator.js --scheduled &

require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const connectDB = require('../db'); 
const Post = require('../models/Post');
const { spawn } = require('child_process');
const path = require('path');

const BATCH_SIZE = process.env.COMMENTS_BATCH_SIZE || 10; // Posts a procesar por ejecución
const DELAY_BETWEEN_POSTS = 5000; // 5 segundos entre posts

/**
 * Obtiene posts pendientes de importar comentarios
 */
async function getPendingPosts() {
    try {
        const pendingPosts = await Post.find({
            'metadata.imported_comments': false,
            'type': 'reddit_tech'
        })
        .sort({ 'metadata.original_comments': -1 }) // Más comentados primero
        .limit(BATCH_SIZE)
        .maxTimeMS(30000);

        console.log(`📋 Encontrados ${pendingPosts.length} posts pendientes de comentarios`);
        return pendingPosts;
    } catch (error) {
        console.error('❌ Error obteniendo posts pendientes:', error.message);
        return [];
    }
}

/**
 * Ejecuta SeedRedditThreadComments.js para un post específico
 */
function runCommentImport(redditUrl, cid, entity) {
    return new Promise((resolve, reject) => {
        console.log(`🚀 Ejecutando importador de comentarios para: ${redditUrl.substring(0, 80)}...`);
        
        const importProcess = spawn('node', [
            path.join(__dirname, 'SeedRedditThreadComments.js')
        ], {
            env: {
                ...process.env,
                REDDIT_URL: redditUrl,
                CID: cid,
                REDDIT_ENTITY: entity.toString()
            },
            stdio: 'inherit' // Mostrar output en tiempo real
        });

        importProcess.on('close', (code) => {
            if (code === 0) {
                console.log(`✅ Importación de comentarios completada exitosamente`);
                resolve(true);
            } else {
                console.error(`❌ Importación de comentarios falló con código: ${code}`);
                resolve(false); // No rechazar para continuar con otros posts
            }
        });

        importProcess.on('error', (error) => {
            console.error(`❌ Error ejecutando importador:`, error.message);
            resolve(false);
        });
    });
}

/**
 * Marca un post como importado
 */
async function markPostAsImported(postId, success = true) {
    try {
        const updateData = {
            'metadata.imported_comments': true,
            'metadata.comments_imported_at': new Date(),
            updated_at: new Date()
        };

        if (!success) {
            updateData['metadata.import_error'] = true;
            updateData['metadata.last_import_error'] = 'Error en ejecución';
        }

        await Post.findByIdAndUpdate(postId, updateData);
        console.log(`📝 Post ${postId} marcado como importado: ${success ? '✅' : '❌'}`);
    } catch (error) {
        console.error(`❌ Error marcando post como importado:`, error.message);
    }
}

/**
 * Procesa un lote de posts pendientes
 */
async function processPendingPostsBatch() {
    let processed = 0;
    let successes = 0;
    let failures = 0;

    try {
        await connectDB();
        console.log('✅ Conectado a la base de datos');
        
        const pendingPosts = await getPendingPosts();
        
        if (pendingPosts.length === 0) {
            console.log('🎉 No hay posts pendientes de comentarios');
            return { processed: 0, successes: 0, failures: 0 };
        }
        
        console.log(`\n📥 Procesando lote de ${pendingPosts.length} posts...`);
        
        for (const post of pendingPosts) {
            console.log(`\n--- Procesando Post ${processed + 1}/${pendingPosts.length} ---`);
            console.log(`📝 Título: ${post.title.substring(0, 60)}...`);
            console.log(`🔗 URL: ${post.reference}`);
            console.log(`🔗 Entity: ${post.entity}`);
            console.log(`💬 Comentarios originales: ${post.metadata?.original_comments || 'N/A'}`);
            
            try {
                const success = await runCommentImport(post.reference, post.cid, post.entity);
                
                if (success) {
                    await markPostAsImported(post._id, true);
                    successes++;
                } else {
                    await markPostAsImported(post._id, false);
                    failures++;
                }
                
                processed++;
                
                // Pausa entre posts (excepto el último)
                if (processed < pendingPosts.length) {
                    console.log(`⏳ Esperando ${DELAY_BETWEEN_POSTS/1000} segundos antes del siguiente post...`);
                    await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_POSTS));
                }
                
            } catch (error) {
                console.error(`❌ Error procesando post ${post._id}:`, error.message);
                await markPostAsImported(post._id, false);
                failures++;
                processed++;
            }
        }
        
        console.log(`\n📊 Procesamiento por lote completado:`);
        console.log(`   ✅ Éxitos: ${successes}`);
        console.log(`   ❌ Fallos: ${failures}`);
        console.log(`   📦 Total procesado: ${processed}`);
        
        return { processed, successes, failures };
        
    } catch (error) {
        console.error('❌ Error en procesamiento por lotes:', error.message);
        return { processed, successes, failures, error: true };
    } finally {
        await mongoose.connection.close();
        console.log('✅ Conexión cerrada');
    }
}

/**
 * Función principal para ejecución manual
 */
async function main() {
    console.log('🚀 Iniciando coordinador de importación de comentarios...');
    console.log(`⏰ Hora de inicio: ${new Date().toISOString()}`);
    
    const result = await processPendingPostsBatch();
    
    console.log(`\n🎉 Coordinador finalizado:`);
    console.log(`   ⏰ Hora de fin: ${new Date().toISOString()}`);
    console.log(`   📊 Resultado: ${result.successes} éxitos, ${result.failures} fallos`);
    
    return result;
}

/**
 * Función para ejecución programada (cada 5 minutos)
 */
async function scheduledExecution() {
    console.log('⏰ Ejecución programada del coordinador...');
    const result = await processPendingPostsBatch();
    
    // Programar siguiente ejecución en 5 minutos
    const nextRun = new Date(Date.now() + 5 * 60 * 1000);
    console.log(`⏭️  Próxima ejecución: ${nextRun.toISOString()}`);
    
    setTimeout(scheduledExecution, 5 * 60 * 1000);
}

// Ejecutar según el modo
if (require.main === module) {
    if (process.argv.includes('--scheduled')) {
        console.log('🔁 Modo programado activado (cada 5 minutos)');
        scheduledExecution();
    } else {
        // Ejecución única
        main().catch(console.error);
    }
}

module.exports = { 
    processPendingPostsBatch, 
    main, 
    scheduledExecution 
};