// controllers/statsController.js
const Post = require('../models/Post');
const Profile = require('../models/Profile');
const Stats = require('../models/Stats');
const GeoStats = require('../models/GeoStats');
const PostStats = require('../models/PostStats'); // Importar el nuevo modelo
const GeoPostStats = require('../models/GeoPostStats'); // Importar el nuevo modelo
const mongoose = require('mongoose');

// Los siguientes modelos ya no son necesarios para los totales, pero se mantienen por si ProfileComment, etc. se usan en otro lugar.
const ProfileComment = require('../models/ProfileComment');
const ProfileLike = require('../models/ProfileLike');
const ProfileShare = require('../models/ProfileShare');

// Función auxiliar para manejar el rango de fechas
const getValidDateRange = (dateFromQuery, dateToQuery) => {
    let dateTo = dateToQuery ? new Date(dateToQuery) : new Date();
    const now = new Date();
    const defaultDateFrom = new Date();
    defaultDateFrom.setDate(now.getDate() - 7); 

    let dateFrom = dateFromQuery ? new Date(dateFromQuery) : null;

    if (!dateFrom || dateFrom > dateTo) {
        dateFrom = defaultDateFrom;
        dateTo = now;
    } else {
        const oneDayMs = 24 * 60 * 60 * 1000;
        if ((dateTo.getTime() - dateFrom.getTime()) < oneDayMs) {
            dateFrom = new Date(dateTo.getTime() - oneDayMs);
        }
    }
    return { dateFrom, dateTo };
};

exports.getSystemStats = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user || !user.clients) {
      return res.status(400).json({
        success: false,
        error: 'User information is missing or invalid'
      });
    }

    const { cid } = req.query;

    // Determinar los cids a usar
    let cidsToUse = [];
    if (cid) {
      const clientExists = user.clients.some(client => client.cid === cid);
      if (!clientExists) {
        return res.status(403).json({
          success: false,
          error: 'You do not have access to this client ID'
        });
      }
      cidsToUse = [cid];
    } else {
      cidsToUse = user.clients.map(client => client.cid);
    }

    // Manejo de fechas
    const { dateFrom, dateTo } = getValidDateRange(req.query.dateFrom, req.query.dateTo);

    // Filtro base para todas las colecciones (totalUsers)
    const baseFilter = { cid: { $in: cidsToUse } };
    
    // Filtro para Posts (aplicando cid y fechas)
    const postFilter = {
      ...baseFilter,
      created_at: { $gte: dateFrom, $lte: dateTo }
    };
    
    // Obtener el número total de usuarios (acumulado)
    const totalUsers = await Profile.countDocuments(baseFilter);

    // Obtener total de posts (en el rango de fechas)
    const totalPosts = await Post.countDocuments(postFilter);

    
    // 🚀 INICIO DE LÓGICA OPTIMIZADA: Sumar campos de conteo en la colección Post 🚀
    
    // 1. Obtener total de comentarios
    const totalCommentsResult = await Post.aggregate([
      { $match: postFilter },
      {
        $group: {
          _id: null,
          totalComments: { $sum: '$commentCount' }
        }
      }
    ]);
    const totalComments = totalCommentsResult[0]?.totalComments || 0;

    // 2. Obtener total de likes
    const totalLikesResult = await Post.aggregate([
      { $match: postFilter },
      {
        $group: {
          _id: null,
          totalLikes: { $sum: '$likesCount' }
        }
      }
    ]);
    const totalLikes = totalLikesResult[0]?.totalLikes || 0;

    // 3. Obtener total de shares
    const totalSharesResult = await Post.aggregate([
      { $match: postFilter },
      {
        $group: {
          _id: null,
          totalShares: { $sum: '$sharesCount' }
        }
      }
    ]);
    const totalShares = totalSharesResult[0]?.totalShares || 0;

    // 🚀 FIN DE LÓGICA OPTIMIZADA 🚀


    // Estadísticas por hora (usando la colección Stats, que almacena métricas por hora)
    const statsByHour = await Stats.aggregate([
      {
        $match: {
          cid: { $in: cidsToUse },
          timestamp: { $gte: dateFrom, $lte: dateTo }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d %H', date: '$timestamp' }
          },
          likesAdded: { $sum: '$likesAdded' },
          likesRemoved: { $sum: '$likesRemoved' },
          sharesAdded: { $sum: '$sharesAdded' },
          commentsAdded: { $sum: '$commentsAdded' },
          repliesAdded: { $sum: '$repliesAdded' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.status(200).json({
      success: true,
      totalUsers,
      totalPosts,
      totalComments, // Ya no usa [0]?.totalComments, el valor es directo
      totalLikes, // Ya no usa [0]?.totalLikes, el valor es directo
      totalShares, // Ya no usa [0]?.totalShares, el valor es directo
      statsByHour: statsByHour.map(hour => ({
        dateHour: hour._id,
        likesAdded: hour.likesAdded,
        likesRemoved: hour.likesRemoved,
        sharesAdded: hour.sharesAdded,
        commentsAdded: hour.commentsAdded,
        repliesAdded: hour.repliesAdded
      })),
      dateRange: {
        from: dateFrom.toISOString(),
        to: dateTo.toISOString()
      },
      cids: cidsToUse // Siempre devolver los cids usados
    });
  } catch (error) {
    console.error('❌ Error fetching system stats:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

/**
  * Busca estadísticas geográficas en GeoStats usando filtros de cid y fechas.
  * @param {Object} params - Parámetros de búsqueda.
  * @param {Object} user - Usuario autenticado con sus cids.
  * @returns {Promise<Array>} - Resultados agrupados con campos geográficos adicionales.
  */
exports.searchGeoStats = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user || !user.clients) {
      return res.status(400).json({
        success: false,
        error: 'User information is missing or invalid'
      });
    }

    const { cid, dateFrom, dateTo } = req.query;

    // Verificar cids del usuario
    let cidsToUse = [];
    if (cid) {
      const clientExists = user.clients.some(client => client.cid === cid);
      if (!clientExists) {
        return res.status(403).json({
          success: false,
          error: 'You do not have access to this client ID'
        });
      }
      cidsToUse = [cid];
    } else {
      cidsToUse = user.clients.map(client => client.cid);
    }

    // Manejo de fechas
    const { dateFrom: from, dateTo: to } = getValidDateRange(dateFrom, dateTo);
    
    // Filtro para GeoStats (no incluye entity, ya que GeoStats es para estadísticas generales)
    const matchFilter = {
        cid: { $in: cidsToUse },
        action: { $in: ['like', 'share', 'comment', 'reply','hit'] },
        timestamp: { $gte: from, $lte: to }
    };

    // Consulta agregada con los nuevos campos
    const results = await GeoStats.aggregate([
      {
        $match: matchFilter
      },
      {
        $group: {
          _id: {
            action: '$action',
            country: '$country',
            countryCode: '$countryCode',
            region: '$region',
            regionCode: '$regionCode',
            city: '$city',
            latitude: '$latitude',
            longitude: '$longitude'
          },
          total: { $sum: '$count' }
        }
      },
      { $sort: { total: -1 } },
      {
        $project: {
          _id: 0,
          action: '$_id.action',
          country: '$_id.country',
          countryCode: { $ifNull: ['$_id.countryCode', null] },
          region: '$_id.region',
          regionCode: { $ifNull: ['$_id.regionCode', null] },
          city: '$_id.city',
          latitude: { $ifNull: ['$_id.latitude', null] },
          longitude: { $ifNull: ['$_id.longitude', null] },
          total: 1
        }
      }
    ]);

    // Filtrar campos nulos/undefined del resultado final
    const cleanResults = results.map(item => {
      const cleanedItem = {};
      Object.keys(item).forEach(key => {
        if (item[key] !== null && item[key] !== undefined) {
          cleanedItem[key] = item[key];
        }
      });
      return cleanedItem;
    });

    return res.status(200).json({
      success: true,
      data: cleanResults,
      dateRange: {
        from: from.toISOString(),
        to: to.toISOString()
      },
      cids: cidsToUse
    });

  } catch (error) {
    console.error('❌ Error fetching geo stats:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};


// 🆕 NUEVO ENDPOINT PARA ESTADÍSTICAS POR POST (ENTITY) 🆕

exports.getPostAnalytics = async (req, res, next) => {
    try {
        const { entity } = req.params;
        const { cid } = req.query;
        const user = req.user;

        // Validaciones de acceso y formato
        if (!user.clients.some(client => client.cid === cid)) {
            return res.status(403).json({ success: false, error: 'Access denied to this client ID' });
        }
        if (!mongoose.Types.ObjectId.isValid(entity)) {
            return res.status(400).json({ success: false, error: 'Invalid entity ID' });
        }
        
        const entityObjectId = new mongoose.Types.ObjectId(entity);

        // Obtener datos básicos del post
        const post = await Post.findOne({ entity, cid }).select('_id entity likesCount sharesCount commentCount').lean();
        if (!post) {
            return res.status(404).json({ success: false, error: 'Post not found' });
        }

        const { dateFrom, dateTo } = getValidDateRange(req.query.dateFrom, req.query.dateTo);

        // 1. Estadísticas por hora (PostStats)
        const postStatsByHour = await PostStats.aggregate([
            {
                $match: {
                    cid,
                    entity: post._id,
                    timestamp: { $gte: dateFrom, $lte: dateTo }
                }
            },
            {
                $group: {
                    _id: {
                        $dateToString: { format: '%Y-%m-%d %H', date: '$timestamp' }
                    },
                    likesAdded: { $sum: '$likesAdded' },
                    likesRemoved: { $sum: '$likesRemoved' },
                    sharesAdded: { $sum: '$sharesAdded' },
                    commentsAdded: { $sum: '$commentsAdded' },
                    repliesAdded: { $sum: '$repliesAdded' }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        // 2. Estadísticas geográficas (GeoPostStats)
        const geoStats = await GeoPostStats.aggregate([
            {
                $match: {
                    cid,
                    entity: entityObjectId, // Filtrar por ObjectId de la entidad
                    action: { $in: ['like', 'share', 'comment', 'reply'] },
                    timestamp: { $gte: dateFrom, $lte: dateTo }
                }
            },
            {
                $group: {
                    _id: {
                        action: '$action',
                        country: '$country',
                        city: '$city',
                        countryCode: '$countryCode',
                        region: '$region',
                        regionCode: '$regionCode',
                        latitude: '$latitude',
                        longitude: '$longitude'
                    },
                    total: { $sum: '$count' }
                }
            },
            { $sort: { total: -1 } },
            {
                $project: {
                    _id: 0,
                    action: '$_id.action',
                    country: '$_id.country',
                    countryCode: { $ifNull: ['$_id.countryCode', null] },
                    region: '$_id.region',
                    regionCode: { $ifNull: ['$_id.regionCode', null] },
                    city: '$_id.city',
                    latitude: { $ifNull: ['$_id.latitude', null] },
                    longitude: { $ifNull: ['$_id.longitude', null] },
                    total: 1
                }
            }
        ]);
        
        // 3. Totales de interacciones
        const interactionTotals = {
            comments: post.commentCount,
            likes: post.likesCount,
            shares: post.sharesCount
        };

        res.status(200).json({
            success: true,
            entityId: entity,
            interactionTotals,
            postStatsByHour,
            geoStats,
            dateRange: {
                from: dateFrom.toISOString(),
                to: dateTo.toISOString()
            }
        });

    } catch (error) {
        console.error('❌ Error fetching post analytics:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};