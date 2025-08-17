const mongoose = require('mongoose');

const ActivitySchema = new mongoose.Schema({
    target_profile_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Profile',
        required: true,
    },
    profile_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Profile',
        required: true,
    },
    author_username: {
        type: String,
        required: true
    },
    picture: {
        type: String,
        required: false,
    },
    action_type: {
        type: String,
        enum: ['like', 'comment', 'reply', 'share', 'follower','follower-request','follow-approval'],
        required: true
    },
    target: {
        type: { type: String, enum: ['post', 'comment','reply', 'profile','like'], required: false },
        id: { type: mongoose.Schema.Types.ObjectId, required: false },
        preview: { type: String, required: false, maxlength: 100 }
    },
    target_profile: {
        profile_id: { type: mongoose.Schema.Types.ObjectId, required: false },
        username: { type: String, required: false },
        picture: { type: String, required: false }
    },
    created_at: {
        type: Date,
        default: Date.now,
        index: -1
    },
    references: {
        profileId: { 
            type: mongoose.Schema.Types.ObjectId, 
            required: false,
            default: null
        },
        replyId: { 
            type: mongoose.Schema.Types.ObjectId, 
            required: false,
            default: null
        },
        commentId: { 
            type: mongoose.Schema.Types.ObjectId, 
            required: false,
            default: null
        },
        entity: { 
            type: mongoose.Schema.Types.ObjectId, 
            required: false,
            default: null
        },
    },
});

// Optimized indexes for queries
ActivitySchema.index({ target_profile_id: 1, action_type: 1, created_at: -1 }); 
ActivitySchema.index({ target_profile_id: 1, action_type: 1, profile_id: 1, created_at: -1 });

module.exports = mongoose.model('Activity', ActivitySchema);