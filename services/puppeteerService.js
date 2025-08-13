// ./services/puppeteerService.js
const puppeteer = require('puppeteer');

class PuppeteerService {
  constructor() {
    this.browser = null;
  }

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

  async scrapePageData(url) {
    if (!url) throw new Error('URL parameter is required');

    const browser = await this.initBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    );

    let jsonResponses = [];
    page.on('response', async (response) => {
      const contentType = response.headers()['content-type'];
      if (contentType && contentType.includes('application/json')) {
        try {
          const text = await response.text();
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
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      finalUrl = page.url();
    } catch (error) {
      console.warn('Error en page.goto:', error.message);
      try { finalUrl = page.url(); } catch {}
    }

    const validJsonResponse = jsonResponses.find(resp => {
      const hasTitle = resp.data.title || resp.data.name;
      const hasDescription = resp.data.description || resp.data.summary;
      return hasTitle || hasDescription;
    });

    let pageData;
    let sourceType = 'html';

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
        // Esperar a que el DOM esté listo
        await page.waitForSelector('body', { timeout: 10000 });

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
          if (err.message.includes('detached')) {
            console.warn('Frame detached, recargando...');
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
        pageData = {
          title: 'Error: Failed to evaluate page',
          description: 'No description',
          canonical: finalUrl,
          finalUrl
        };
      }
    }

    try {
      if (!page.isClosed()) {
        await page.close();
      }
    } catch (e) {
      console.warn('No se pudo cerrar la página:', e.message);
    }

    return { data: pageData, sourceType, redirected: finalUrl !== url };
  }


  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}

module.exports = new PuppeteerService();