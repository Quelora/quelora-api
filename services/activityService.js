// ./services/activityService.js
const mongoose = require('mongoose');
const Activity = require('../models/Activity');

// Logs an activity in the database
// Parameters:
// - author: Object containing user details (_id, picture, username)
// - actionType: String indicating the type of action performed
// - target: Optional object with target details (type, id, preview)
// - targetProfile: Optional object with target profile details (_id)
// - references: Optional object with additional references (profileId, replyId, commentId, entity)
const logActivity = async ({ author, actionType, target, targetProfile, references = {} }) => {
  try {
    // Validate author _id
    if (!author?._id) {
      throw new Error('Incomplete author data');
    }

    // Clean references by filtering out undefined, null, or empty values
    // and ensuring valid ObjectId for specified fields
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
    
    // Construct activity data object
    const activityData = {
      target_profile_id: targetProfile?._id ?? author?._id, // Defaults to author's _id if targetProfile is not provided
      profile_id: author?._id,
      picture: author.picture,
      author_username: author.username,
      action_type: actionType,
      references: cleanedReferences,
      created_at: new Date()
    };

    // Add target details if provided
    if (target) {
      activityData.target = {
        type: target.type,
        id: target.id,
        preview: target.preview?.substring(0, 100) ?? '' // Limit preview to 100 characters
      };
    }

    // Create and return the activity record
    return await Activity.create(activityData);
    
  } catch (error) {
    // Log error and rethrow
    console.error("❌ Error recording activity:", error.message);
    throw error;
  }
};

// Export the logActivity function
module.exports = {
  logActivity
};