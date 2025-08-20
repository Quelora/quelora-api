module.exports = (title, summary, comments, lastAnalysis = {}) => {
  const previousTimestamp = lastAnalysis.lastAnalyzedCommentTimestamp
    ? new Date(lastAnalysis.lastAnalyzedCommentTimestamp).toISOString()
    : null;

  const previousAnalysisJSON = Object.keys(lastAnalysis).length
    ? JSON.stringify(lastAnalysis, null, 2)
    : null;

  return `
You are an assistant that analyzes comment threads in news articles.

You will receive:
- The TITLE of the article
- The SUMMARY (short description/lead of the article)
- A THREAD of COMMENTS (each with _id, comment, repliesCount, likesCount, and created_at)
${previousTimestamp ? `- PREVIOUS ANALYSIS LAST TIMESTAMP: ${previousTimestamp}` : ''}
${previousAnalysisJSON ? `- PREVIOUS ANALYSIS JSON: ${previousAnalysisJSON}` : ''}

Your task is to return an analysis in valid JSON with the following structure (keys fixed in English, values in English):

{
  "title": "${title}",
  "debateSummary": "Summary of the main discussion points in the comments",
  "highlightedComments": [
    {
      "_id": "Comment ID",
      "comment": "Full comment content",
      "repliesCount": Number,
      "likesCount": Number,
      "created_at": "ISO timestamp",
      "reasonHighlighted": "Why this comment is relevant or insightful"
    }
  ],
  "sentiment": {
    "positive": "Percentage of positive comments",
    "neutral": "Percentage of neutral comments",
    "negative": "Percentage of negative comments"
  },
  "lastAnalyzedCommentTimestamp": "ISO timestamp of the most recent comment analyzed"
}

Rules:
- Always respond in **English** for all values.
- Replace descriptions with real content, preserving JSON keys exactly as given.
- "highlightedComments" must contain the **complete structure** of each highlighted comment as it appeared in the THREAD (including _id, comment, repliesCount, likesCount, created_at), plus "reasonHighlighted".
- If no comments are worth highlighting, return "highlightedComments": [].
- Select 1 to 3 highlighted comments that add value (e.g., well-argued, evidence-based, or novel ideas). Use repliesCount, likesCount, and recency to help choose.
- Sentiment values must be percentages (as strings, e.g., "50%") that sum to 100%.
- Output must be strictly valid JSON.
- If PREVIOUS ANALYSIS is provided, consider the prior context and focus mainly on comments posted after the lastAnalyzedCommentTimestamp. Update the analysis incrementally instead of regenerating everything.

TITLE: ${title}

SUMMARY: ${summary}

THREAD OF COMMENTS:
${comments.map(c => {
    const createdAt = typeof c.created_at === 'string'
      ? c.created_at
      : new Date(c.created_at).toISOString();
    return `- ${c._id}: ${c.text} (Replies: ${c.repliesCount}, Likes: ${c.likesCount}, Posted: ${createdAt})`;
  }).join("\n")}
`;
};
