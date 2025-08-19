// utils/formatComment.js
const formatComment = (comment, profile, currentUser = '') => {
  const isEdited = comment.created_at < comment.updated_at;

  // Verificar si `author` es un objeto o un string
  const profileIsObject = typeof profile === 'object';
  const author = profileIsObject ? profile.author : profile;
  const profileData = profileIsObject ? profile : {};

  return {
      _id: comment._id,
      profile: profileData, 
      author: author,
      authorOwner: author === currentUser,
      text: comment.text,
      language: comment.language ?? '',
      timestamp: isEdited ? comment.updated_at : comment.created_at,
      likes: comment.likesCount,
      authorLiked: comment.likes?.includes(currentUser),
      repliesCount: comment.repliesCount,
      isEdited: isEdited,
      visible: comment.visible ?? true,
      hasAudio: comment.hasAudio ?? false
  };
};
  
module.exports = formatComment;