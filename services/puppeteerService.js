// ./services/puppeteerService.js

// PuppeteerService class for web scraping using Puppeteer.
const puppeteer = require('puppeteer');

class PuppeteerService {
  // Initializes browser property to null.
  constructor() {
    this.browser = null;
  }

  // Launches a headless Puppeteer browser if not already initialized.
  // Uses environment variable for executable path and specific args for stability.
  async initBrowser() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });
    }
    return this.browser;
  }

  // Scrapes data from a given URL, prioritizing JSON responses or falling back to HTML parsing.
  // Throws error if URL is not provided.
  async scrapePageData(url) {
    if (!url) throw new Error('URL parameter is required');

    const browser = await this.initBrowser();
    const page = await browser.newPage();
    // Sets a realistic user agent to mimic a browser.
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    );

    // Captures JSON responses from network requests.
    let jsonResponses = [];
    page.on('response', async (response) => {
      const contentType = response.headers()['content-type'];
      if (contentType && contentType.includes('application/json')) {
        try {
          const text = await response.text();
          // Removes JSONP prefix if present.
          const cleanedText = text.startsWith(')]}') ? text.slice(4) : text;
          const data = JSON.parse(cleanedText);
          if (typeof data === 'object' && data !== null) {
            jsonResponses.push({
              url: response.url(),
              data,
              status: response.status()
            });
          }
        } catch (e) {
          console.log('Error parsing JSON response:', e);
        }
      }
    });

    let finalUrl = url;
    // Navigates to the URL, waiting for network to be idle or up to 30s.
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      finalUrl = page.url();
    } catch (error) {
      console.warn('Error in page.goto:', error.message);
      try { finalUrl = page.url(); } catch {}
    }

    // Finds a valid JSON response with title or description.
    const validJsonResponse = jsonResponses.find(resp => {
      const hasTitle = resp.data.title || resp.data.name;
      const hasDescription = resp.data.description || resp.data.summary;
      return hasTitle || hasDescription;
    });

    let pageData;
    let sourceType = 'html';

    // Processes JSON response if valid, otherwise falls back to HTML parsing.
    if (validJsonResponse) {
      sourceType = 'json';
      pageData = {
        title: validJsonResponse.data.title || validJsonResponse.data.name || 'No title',
        description: validJsonResponse.data.description || validJsonResponse.data.summary || 'No description',
        canonical: validJsonResponse.data.url || validJsonResponse.data.link || validJsonResponse.data.canonical || finalUrl,
        finalUrl
      };
    } else {
      try {
        // Waits for DOM to be ready (up to 10s).
        await page.waitForSelector('body', { timeout: 10000 });

        // Evaluates page to extract title, description, and canonical URL.
        const evalFn = () => {
          return {
            title: document.title || 'No title',
            description: document.querySelector('meta[name="description"]')?.content || 'No description',
            canonical: document.querySelector('link[rel="canonical"]')?.href || window.location.href,
            finalUrl: window.location.href
          };
        };

        try {
          pageData = await page.evaluate(evalFn);
        } catch (err) {
          // Handles detached frame by reloading the page and retrying.
          if (err.message.includes('detached')) {
            console.warn('Frame detached, reloading...');
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
            await page.waitForSelector('body', { timeout: 10000 });
            pageData = await page.evaluate(evalFn);
          } else {
            throw err;
          }
        }

        if (!pageData) throw new Error('Document not available');
      } catch (error) {
        console.error('Error evaluating page:', error);
        // Returns fallback data on evaluation failure.
        pageData = {
          title: 'Error: Failed to evaluate page',
          description: 'No description',
          canonical: finalUrl,
          finalUrl
        };
      }
    }

    // Closes the page if not already closed.
    try {
      if (!page.isClosed()) {
        await page.close();
      }
    } catch (e) {
      console.warn('Failed to close page:', e.message);
    }

    // Returns scraped data, source type, and redirection status.
    return { data: pageData, sourceType, redirected: finalUrl !== url };
  }

  // Closes the browser and resets the browser property.
  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

// Exports a singleton instance of PuppeteerService.
module.exports = new PuppeteerService();