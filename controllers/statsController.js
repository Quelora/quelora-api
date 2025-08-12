const Post = require('../models/Post');
const Profile = require('../models/Profile');
const Stats = require('../models/Stats');
const GeoStats = require('../models/GeoStats');

const ProfileComment = require('../models/ProfileComment');
const ProfileLike = require('../models/ProfileLike');
const ProfileShare = require('../models/ProfileShare');

exports.getSystemStats = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user || !user.clients) {
      return res.status(400).json({
        success: false,
        error: 'User information is missing or invalid'
      });
    }

    const { cid } = req.body;

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
    let dateFrom = req.query.dateFrom ? new Date(req.query.dateFrom) : null;
    let dateTo = req.query.dateTo ? req.query.dateTo ? new Date(req.query.dateTo) : new Date() : new Date();

    // Validar y ajustar el rango de fechas
    const now = new Date();
    const defaultDateFrom = new Date();
    defaultDateFrom.setDate(now.getDate() - 7); // Por defecto: últimos 7 días

    if (!dateFrom || !dateTo || dateFrom > dateTo) {
      dateFrom = defaultDateFrom;
      dateTo = now;
    } else {
      const oneDayMs = 24 * 60 * 60 * 1000;
      if ((dateTo - dateFrom) < oneDayMs) {
        dateFrom = new Date(dateTo.getTime() - oneDayMs);
      }
    }

    // Filtro para posts y otras colecciones
    const baseFilter = cidsToUse.length > 0 ? { cid: { $in: cidsToUse } } : {};
    const postFilter = {
      ...baseFilter,
      created_at: { $gte: dateFrom, $lte: dateTo }
    };
    const interactionFilter = {
      created_at: { $gte: dateFrom, $lte: dateTo }
    };

    // Obtener el número total de usuarios
    const totalUsers = await Profile.countDocuments(baseFilter);

    // Obtener total de posts
    const totalPosts = await Post.countDocuments(postFilter);

    // Obtener total de comentarios
    const totalComments = await ProfileComment.aggregate([
      {
        $lookup: {
          from: 'posts',
          localField: 'entity',
          foreignField: '_id',
          as: 'post'
        }
      },
      { $unwind: '$post' },
      { $match: { ...interactionFilter, 'post.cid': { $in: cidsToUse.length > 0 ? cidsToUse : await Post.distinct('cid') } } },
      { $count: 'totalComments' }
    ]);

    // Obtener total de likes
    const totalLikes = await ProfileLike.aggregate([
      {
        $lookup: {
          from: 'posts',
          localField: 'entity',
          foreignField: '_id',
          as: 'post'
        }
      },
      { $unwind: '$post' },
      {
        $match: {
          ...interactionFilter,
          'post.cid': { $in: cidsToUse.length > 0 ? cidsToUse : await Post.distinct('cid') },
          entity_type: 'post'
        }
      },
      { $count: 'totalLikes' }
    ]);

    // Obtener total de shares
    const totalShares = await ProfileShare.aggregate([
      {
        $lookup: {
          from: 'posts',
          localField: 'entity',
          foreignField: '_id',
          as: 'post'
        }
      },
      { $unwind: '$post' },
      { $match: { ...interactionFilter, 'post.cid': { $in: cidsToUse.length > 0 ? cidsToUse : await Post.distinct('cid') } } },
      { $count: 'totalShares' }
    ]);

    // Estadísticas por hora
    const statsByHour = await Stats.aggregate([
      {
        $match: {
          ...(cidsToUse.length > 0 && { cid: { $in: cidsToUse } }),
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
      totalComments: totalComments[0]?.totalComments || 0,
      totalLikes: totalLikes[0]?.totalLikes || 0,
      totalShares: totalShares[0]?.totalShares || 0,
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
      ...(cid && { cid })
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
    const now = new Date();
    const defaultDateFrom = new Date();
    defaultDateFrom.setDate(now.getDate() - 7); // últimos 7 días

    let from = dateFrom ? new Date(dateFrom) : defaultDateFrom;
    let to = dateTo ? new Date(dateTo) : now;

    if (from > to) {
      from = defaultDateFrom;
      to = now;
    } else {
      const oneDayMs = 24 * 60 * 60 * 1000;
      if ((to - from) < oneDayMs) {
        from = new Date(to.getTime() - oneDayMs);
      }
    }

    // Consulta agregada con los nuevos campos
    const results = await GeoStats.aggregate([
      {
        $match: {
          cid: { $in: cidsToUse },
          timestamp: { $gte: from, $lte: to }
        }
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
      ...(cid && { cid })
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