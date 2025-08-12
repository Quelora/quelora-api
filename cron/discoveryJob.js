// ./cron/discoveryJob.js
const cron = require('node-cron');
const { getClientConfig } = require('../services/clientConfigService');
const PuppeteerService = require('../services/puppeteerService');
const Post = require('../models/Post');

let isJobRunning = false;

async function updateDiscoveryPosts() {
  // Skip if a previous job is still running
  if (isJobRunning) {
    console.log('⏲️  Previous discovery job still running, skipping...');
    return;
  }

  isJobRunning = true;
  let processedPosts = 0;
  try {
    // Fetch 100 posts with empty title and modeDiscovery true
    const posts = await Post.find({ title: { $in: [null, ''] }, 'config.modeDiscovery': true }).limit(100);

    for (const post of posts) {
      const { cid, reference } = post;

      // Get client configuration
      const discoveryDataUrl = await getClientConfig(cid, 'discoveryDataUrl');
      const modeDiscovery = await getClientConfig(cid, 'modeDiscovery');

      // Skip if modeDiscovery is not true
      if (modeDiscovery !== true) {
        continue;
      }

      // Replace {{reference}} in the URL
      const url = discoveryDataUrl?.replace('{{reference}}', reference);

      // Update post with error if no URL is configured
      if (!url) {
        await Post.findByIdAndUpdate(post._id, {
          title: 'Error: No discoveryDataUrl configured',
          updated_at: new Date()
        });
        processedPosts++;
        continue;
      }

      try {
        // Scrape page data
        const { data } = await PuppeteerService.scrapePageData(url);
        if (data.title && data.description && data.canonical) {
          // Update post with scraped data
          await Post.findByIdAndUpdate(post._id, {
            title: data.title,
            description: data.description,
            link: data.canonical,
            updated_at: new Date()
          });
        } else {
          // Update post with error if data is incomplete
          await Post.findByIdAndUpdate(post._id, {
            title: 'Error: Incomplete data retrieved',
            updated_at: new Date()
          });
        }
      } catch (error) {
        console.error(`Error scraping URL ${url} for post ${post._id}:`, error);
        // Update post with error if scraping fails
        await Post.findByIdAndUpdate(post._id, {
          title: 'Error: Failed to scrape data',
          updated_at: new Date()
        });
      }
      processedPosts++;
    }
  } finally {
    // Close browser and reset job flag
    await PuppeteerService.closeBrowser();
    isJobRunning = false;
    // Log job completion with timestamp and processed posts count
    console.log(`⏲️  Discovery job completed at ${new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' })}: Processed ${processedPosts} posts`);
  }
}

// Schedule job to run every 10 seconds
cron.schedule('*/10 * * * * *', async () => {
  console.log('⏲️  Starting discovery job');
  await updateDiscoveryPosts();
});