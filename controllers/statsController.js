// controllers/statsController.js

const Post = require('../models/Post');
const Profile = require('../models/Profile');
const Stats = require('../models/Stats');
const GeoStats = require('../models/GeoStats');
const PostStats = require('../models/PostStats');
const GeoPostStats = require('../models/GeoPostStats');
const mongoose = require('mongoose');

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

        const { dateFrom, dateTo } = getValidDateRange(req.query.dateFrom, req.query.dateTo);

        const baseFilter = { cid: { $in: cidsToUse } };
        
        const postFilter = {
            ...baseFilter,
            created_at: { $gte: dateFrom, $lte: dateTo }
        };
        
        const totalUsers = await Profile.countDocuments(baseFilter);

        const totalPosts = await Post.countDocuments(postFilter);

        
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
            totalComments,
            totalLikes,
            totalShares,
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
            cids: cidsToUse
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

        const { dateFrom: from, dateTo: to } = getValidDateRange(dateFrom, dateTo);
        
        const matchFilter = {
                cid: { $in: cidsToUse },
                action: { $in: ['like', 'share', 'comment', 'reply','hit'] },
                timestamp: { $gte: from, $lte: to }
        };

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

exports.getPostListStats = async (req, res, next) => {
    try {
        const user = req.user;
        const { cid, page = 1, limit = 10, sortBy = 'viewsCount', sortOrder = 'desc', dateFrom, dateTo } = req.query;

        if (!user || !user.clients) {
            return res.status(400).json({ success: false, error: 'User information is missing or invalid' });
        }

        let cidsToUse = [];
        if (cid) {
            const clientExists = user.clients.some(client => client.cid === cid);
            if (!clientExists) {
                return res.status(403).json({ success: false, error: 'Access denied to this client ID' });
            }
            cidsToUse = [cid];
        } else {
            cidsToUse = user.clients.map(client => client.cid);
        }

        const { dateFrom: from, dateTo: to } = getValidDateRange(dateFrom, dateTo);
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const limitValue = parseInt(limit);
        
        const sortDirection = sortOrder === 'asc' ? 1 : -1;
        const sortCriteria = { [sortBy]: sortDirection, _id: sortDirection };

        const matchFilter = {
            cid: { $in: cidsToUse },
            created_at: { $gte: from, $lte: to },
            'deletion.status': 'active'
        };

        const countResult = await Post.aggregate([
            { $match: matchFilter },
            { $count: "totalCount" }
        ]);
        const totalCount = countResult.length > 0 ? countResult[0].totalCount : 0;
        
        const posts = await Post.aggregate([
            { $match: matchFilter },
            { $sort: sortCriteria },
            { $skip: skip },
            { $limit: limitValue },
            {
                $project: {
                    _id: 0,
                    entity: '$entity',
                    title: { $ifNull: ['$title', '(Sin título)'] },
                    link: { $ifNull: ['$link', null] },
                    viewsCount: '$viewsCount',
                    likesCount: '$likesCount',
                    commentCount: '$commentCount',
                    sharesCount: '$sharesCount',
                    created_at: '$created_at'
                }
            }
        ]);

        res.status(200).json({
            success: true,
            data: posts,
            pagination: {
                totalPosts: totalCount,
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / limitValue),
                limit: limitValue
            },
            dateRange: {
                from: from.toISOString(),
                to: to.toISOString()
            },
            cids: cidsToUse
        });

    } catch (error) {
        console.error('❌ Error fetching post list stats:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

exports.getPostAnalytics = async (req, res, next) => {
    try {
        const { entity } = req.params;
        const { cid } = req.query;
        const user = req.user;

        if (!user.clients.some(client => client.cid === cid)) {
            return res.status(403).json({ success: false, error: 'Access denied to this client ID' });
        }
        if (!mongoose.Types.ObjectId.isValid(entity)) {
            return res.status(400).json({ success: false, error: 'Invalid entity ID' });
        }
        
        const entityObjectId = new mongoose.Types.ObjectId(entity);

        const post = await Post.findOne({ entity, cid }).select('_id entity likesCount sharesCount commentCount').lean();
        if (!post) {
            return res.status(404).json({ success: false, error: 'Post not found' });
        }

        const { dateFrom, dateTo } = getValidDateRange(req.query.dateFrom, req.query.dateTo);

        // 🚀 FIX DE BACKEND: Asegurar que la consulta de PostStats sea correcta 🚀
        const postStatsByHour = await PostStats.aggregate([
            {
                $match: {
                    cid,
                    entity: entityObjectId,
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
            { 
                $project: {
                    _id: 0,
                    dateHour: '$_id',
                    likesAdded: 1,
                    likesRemoved: 1,
                    sharesAdded: 1,
                    commentsAdded: 1,
                    repliesAdded: 1
                }
            },
            { $sort: { dateHour: 1 } }
        ]);
        // --------------------------------------------------------------------------

        const geoStats = await GeoPostStats.aggregate([
            {
                $match: {
                    cid,
                    entity: entityObjectId,
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
        
        const interactionTotals = {
            comments: post.commentCount,
            likes: post.likesCount,
            shares: post.sharesCount
        };

        res.status(200).json({
            success: true,
            entityId: entity,
            interactionTotals,
            postStatsByHour, // Ahora contiene los datos si existen
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