#!/usr/bin/env node

/**
 * Debug scraper to test website structure
 */

require('dotenv').config({ quiet: true });
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

async function debugZomato() {
  console.log('🔍 Debugging Zomato structure...');

  const browser = await puppeteer.launch({
    headless: false, // Show browser for debugging
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    const url = 'https://www.zomato.com/mumbai/restaurants';
    console.log(`📍 Navigating to: ${url}`);

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Try to scroll to trigger loading
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight / 2);
    });
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Debug: Check what elements exist
    const pageInfo = await page.evaluate(() => {
      const info = {
        title: document.title,
        url: window.location.href,
        bodyText: document.body.innerText.substring(0, 500),
        allElements: [],
        potentialRestaurants: []
      };

      // Check various potential selectors
      const testSelectors = [
        'article',
        '[data-testid*="restaurant"]',
        '[class*="restaurant"]',
        '[class*="card"]',
        'section',
        'div[role="button"]'
      ];

      testSelectors.forEach(selector => {
        try {
          const elements = document.querySelectorAll(selector);
          if (elements.length > 0) {
            info.allElements.push(`${selector}: ${elements.length} elements`);

            // Check first few elements for restaurant-like content
            Array.from(elements).slice(0, 5).forEach((el, idx) => {
              const text = el.innerText?.trim().substring(0, 100);
              const hasRestaurantKeywords = /restaurant|food|cuisine|rating|delivery/i.test(text);
              if (hasRestaurantKeywords && text.length > 10) {
                info.potentialRestaurants.push(`${selector}[${idx}]: ${text}`);
              }
            });
          }
        } catch (e) {
          info.allElements.push(`${selector}: ERROR - ${e.message}`);
        }
      });

      return info;
    });

    console.log('\n📄 Page Info:');
    console.log('Title:', pageInfo.title);
    console.log('URL:', pageInfo.url);
    console.log('\n🔍 Element counts:');
    pageInfo.allElements.forEach(item => console.log('  ' + item));

    console.log('\n🍽️  Potential restaurants:');
    pageInfo.potentialRestaurants.slice(0, 10).forEach(item => console.log('  ' + item));

    // Wait for manual inspection
    console.log('\n⏳ Waiting 10 seconds for manual inspection...');
    await new Promise(resolve => setTimeout(resolve, 10000));

  } catch (error) {
    console.error('❌ Debug error:', error.message);
  } finally {
    await browser.close();
  }
}

async function debugSwiggy() {
  console.log('\n🔍 Debugging Swiggy structure...');

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    const url = 'https://www.swiggy.com/city/mumbai';
    console.log(`📍 Navigating to: ${url}`);

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(resolve => setTimeout(resolve, 8000));

    const pageInfo = await page.evaluate(() => {
      return {
        title: document.title,
        url: window.location.href,
        bodyText: document.body.innerText.substring(0, 300),
        elementCounts: {
          articles: document.querySelectorAll('article').length,
          sections: document.querySelectorAll('section').length,
          divs: document.querySelectorAll('div').length,
          buttons: document.querySelectorAll('button').length
        }
      };
    });

    console.log('\n📄 Swiggy Page Info:');
    console.log('Title:', pageInfo.title);
    console.log('URL:', pageInfo.url);
    console.log('Elements:', pageInfo.elementCounts);
    console.log('Body preview:', pageInfo.bodyText);

    await new Promise(resolve => setTimeout(resolve, 5000));

  } catch (error) {
    console.error('❌ Swiggy debug error:', error.message);
  } finally {
    await browser.close();
  }
}

async function main() {
  const command = process.argv[2];

  switch (command) {
    case 'zomato':
      await debugZomato();
      break;
    case 'swiggy':
      await debugSwiggy();
      break;
    default:
      await debugZomato();
      break;
  }
}

main().catch(console.error);