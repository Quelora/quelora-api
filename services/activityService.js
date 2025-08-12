// ./services/activityService.js
const mongoose = require('mongoose');
const Activity = require('../models/Activity');

const logActivity = async ({ author, actionType, target, targetProfile, references = {} }) => {
  try {
    if (!author?._id) {
      throw new Error('Incomplete author data');
    }

    // Filter refernces undefined or null
    const cleanedReferences = {};
        const validFields = ['profileId', 'replyId', 'commentId', 'entity'];

    for (const field of validFields) {
      const value = references[field];
      if (value !== undefined && value !== null && value !== '') {
        if (mongoose.Types.ObjectId.isValid(value)) {
          cleanedReferences[field] = value;
        }
      }
    }
    
    const activityData = {
      target_profile_id: targetProfile?._id ?? author?._id,
      profile_id: author?._id,
      picture: author.picture,
      author_username: author.username,
      action_type: actionType,
      references: cleanedReferences,
      created_at: new Date()
    };

    if (target) {
      activityData.target = {
        type: target.type,
        id: target.id,
        preview: target.preview?.substring(0, 100) ?? ''
      };
    }

    return await Activity.create(activityData);
    
  } catch (error) {
    console.error("❌ Error recording activity:", error.message);
    throw error;
  }
};

module.exports = {
  logActivity
};