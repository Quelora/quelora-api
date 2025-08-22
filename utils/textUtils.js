const toUnicodeBold = (text) => {
  if (!text) return text;

  const boldMap = {
    'a': '𝗮', 'b': '𝗯', 'c': '𝗰', 'd': '𝗱', 'e': '𝗲', 'f': '𝗳', 'g': '𝗴',
    'h': '𝗵', 'i': '𝗶', 'j': '𝗷', 'k': '𝗸', 'l': '𝗹', 'm': '𝗺', 'n': '𝗻',
    'o': '𝗼', 'p': '𝗽', 'q': '𝗾', 'r': '𝗿', 's': '𝘀', 't': '𝘁', 'u': '𝘂',
    'v': '𝘃', 'w': '𝘄', 'x': '𝘅', 'y': '𝘆', 'z': '𝘇',
    'ñ': '𝗻̃', 
    'á': '𝗮́', 'é': '𝗲́', 'í': '𝗶́', 'ó': '𝗼́', 'ú': '𝘂́',
    'ü': '𝘂̈', 'Ñ': '𝗡̃',
    
    'A': '𝗔', 'B': '𝗕', 'C': '𝗖', 'D': '𝗗', 'E': '𝗘', 'F': '𝗙', 'G': '𝗚',
    'H': '𝗛', 'I': '𝗜', 'J': '𝗝', 'K': '𝗞', 'L': '𝗟', 'M': '𝗠', 'N': '𝗡',
    'O': '𝗢', 'P': '𝗣', 'Q': '𝗤', 'R': '𝗥', 'S': '𝗦', 'T': '𝗧', 'U': '𝗨',
    'V': '𝗩', 'W': '𝗪', 'X': '𝗫', 'Y': '𝗬', 'Z': '𝗭',
    'Á': '𝗔́', 'É': '𝗘́', 'Í': '𝗜́', 'Ó': '𝗢́', 'Ú': '𝗨́',
    
    '0': '𝟬', '1': '𝟭', '2': '𝟮', '3': '𝟯', '4': '𝟰', '5': '𝟱',
    '6': '𝟲', '7': '𝟳', '8': '𝟴', '9': '𝟵', ' ': ' '
  };

  return text.split('').map(char => boldMap[char] || char).join('');
}


const validateSearchQuery = (query) => {
  if (!query) return null;
  const queryRegex = /^[a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s]{1,15}$/;
  if (!queryRegex.test(query)) {
    throw new Error('Invalid search query. Only letters, numbers and spaces are allowed (max 15 chars)');
  }
  return query.trim();
}

const decodeHtmlEntities = (text) => {
  const entities = {
    '&amp;': '&',
    '&quot;': '"',
    '&#39;': "'",
    '&lt;': '<',
    '&gt;': '>',
  };
  return text.replace(/&amp;|&quot;|&#39;|&lt;|&gt;/g, (match) => entities[match]);
};

module.exports = { toUnicodeBold, validateSearchQuery, decodeHtmlEntities };