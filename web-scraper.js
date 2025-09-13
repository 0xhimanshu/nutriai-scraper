#!/usr/bin/env node

/**
 * NutriAI Web Scraper - Direct website scraping
 * Scrapes food delivery platforms without APIs
 */

require('dotenv').config({ quiet: true });
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises;

// Enable stealth mode to avoid detection
puppeteer.use(StealthPlugin());

// Configuration
const CONFIG = {
  // Food delivery platforms to scrape
  PLATFORMS: [
    {
      name: 'Zomato',
      searchUrl: (city) => `https://www.zomato.com/${city.toLowerCase()}/restaurants`,
      cityUrls: {
        mumbai: 'https://www.zomato.com/mumbai/restaurants',
        delhi: 'https://www.zomato.com/ncr/restaurants',
        bangalore: 'https://www.zomato.com/bangalore/restaurants',
        dubai: 'https://www.zomato.com/dubai/restaurants'
      }
    },
    {
      name: 'Swiggy',
      cityUrls: {
        mumbai: 'https://www.swiggy.com/city/mumbai',
        delhi: 'https://www.swiggy.com/city/delhi',
        bangalore: 'https://www.swiggy.com/city/bangalore'
      }
    }
  ],

  CITIES: [
    'mumbai',
    'delhi',
    'bangalore',
    'dubai'
  ]
};

// Logging function
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${message}`);
}

// Utility function to wait
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Scrape Zomato restaurants
async function scrapeZomato(city) {
  log(`🍽️  Scraping Zomato restaurants in ${city}...`);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    const platform = CONFIG.PLATFORMS.find(p => p.name === 'Zomato');
    const url = platform.cityUrls[city];

    if (!url) {
      log(`❌ No URL configured for ${city} on Zomato`, 'WARN');
      return [];
    }

    log(`📍 Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await wait(3000);

    // Try to scroll to load more content
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight / 2);
    });
    await wait(2000);

    // Extract restaurant data
    const restaurants = await page.evaluate(() => {
      const results = [];

      // Multiple selectors to try for different page layouts
      const selectors = [
        '[data-testid="restaurant-card"]',
        '.restaurant-card',
        '.res-card',
        '[class*="restaurant"]',
        '[class*="RestaurantCard"]'
      ];

      let restaurantElements = [];
      let usedSelector = '';

      for (const selector of selectors) {
        try {
          restaurantElements = Array.from(document.querySelectorAll(selector));
          if (restaurantElements.length > 0) {
            usedSelector = selector;
            break;
          }
        } catch (e) {
          console.log(`Selector failed: ${selector} - ${e.message}`);
        }
      }

      if (restaurantElements.length === 0) {
        // Fallback: look for any card-like elements
        try {
          restaurantElements = Array.from(document.querySelectorAll('[class*="card"], [class*="Card"], [class^="sc-"]'));
          usedSelector = 'fallback';
        } catch (e) {
          console.log(`Fallback selector failed: ${e.message}`);
          // Last resort - try finding common elements
          restaurantElements = Array.from(document.querySelectorAll('article, section, .card, [role="button"]'));
          usedSelector = 'last resort';
        }
      }

      console.log(`Found ${restaurantElements.length} elements using selector: ${usedSelector}`);

      restaurantElements.slice(0, 50).forEach((element, index) => {
        try {
          const nameSelectors = [
            '[data-testid="restaurant-name"]',
            'h3', 'h4', '.restaurant-name',
            '[class*="name"]', '[class*="Name"]',
            '[class*="title"]', '[class*="Title"]'
          ];

          let name = '';
          for (const sel of nameSelectors) {
            const nameEl = element.querySelector(sel);
            if (nameEl && nameEl.textContent?.trim()) {
              name = nameEl.textContent.trim();
              break;
            }
          }

          // Extract other info
          const cuisineEl = element.querySelector('[class*="cuisine"], [class*="Cuisine"], [data-testid="cuisine"]');
          const ratingEl = element.querySelector('[class*="rating"], [class*="Rating"], [data-testid="rating"]');
          const addressEl = element.querySelector('[class*="address"], [class*="Address"], [class*="locality"]');
          const priceEl = element.querySelector('[class*="price"], [class*="Price"], [class*="cost"]');
          const imageEl = element.querySelector('img');

          if (name) {
            results.push({
              name: name,
              cuisine: cuisineEl?.textContent?.trim() || '',
              rating: ratingEl?.textContent?.trim() || '',
              address: addressEl?.textContent?.trim() || '',
              price: priceEl?.textContent?.trim() || '',
              image: imageEl?.src || '',
              platform: 'Zomato',
              scraped_at: new Date().toISOString()
            });
          }
        } catch (err) {
          console.log(`Error processing element ${index}:`, err.message);
        }
      });

      return results;
    });

    log(`✅ Found ${restaurants.length} restaurants on Zomato in ${city}`);
    return restaurants.map(r => ({ ...r, city }));

  } catch (error) {
    log(`❌ Error scraping Zomato ${city}: ${error.message}`, 'ERROR');
    return [];
  } finally {
    await browser.close();
  }
}

// Scrape Swiggy restaurants
async function scrapeSwiggy(city) {
  log(`🛵 Scraping Swiggy restaurants in ${city}...`);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    const platform = CONFIG.PLATFORMS.find(p => p.name === 'Swiggy');
    const url = platform.cityUrls[city];

    if (!url) {
      log(`❌ No URL configured for ${city} on Swiggy`, 'WARN');
      return [];
    }

    log(`📍 Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await wait(5000);

    // Scroll to load more content
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight / 3);
    });
    await wait(3000);

    const restaurants = await page.evaluate(() => {
      const results = [];

      const selectors = [
        '[data-testid="restaurant-card"]',
        '[class*="RestaurantList"]',
        '[class*="restaurant"]',
        '[class*="card"]'
      ];

      let restaurantElements = [];

      for (const selector of selectors) {
        restaurantElements = Array.from(document.querySelectorAll(selector));
        if (restaurantElements.length > 0) break;
      }

      restaurantElements.slice(0, 50).forEach((element, index) => {
        try {
          const nameSelectors = [
            'h3', 'h4', 'h2',
            '[class*="name"]', '[class*="Name"]',
            '[class*="title"]', '[class*="Title"]'
          ];

          let name = '';
          for (const sel of nameSelectors) {
            const nameEl = element.querySelector(sel);
            if (nameEl && nameEl.textContent?.trim()) {
              name = nameEl.textContent.trim();
              break;
            }
          }

          const cuisineEl = element.querySelector('[class*="cuisine"], [class*="Cuisine"]');
          const ratingEl = element.querySelector('[class*="rating"], [class*="Rating"]');
          const addressEl = element.querySelector('[class*="address"], [class*="Address"], [class*="area"]');
          const timeEl = element.querySelector('[class*="time"], [class*="Time"], [class*="delivery"]');
          const imageEl = element.querySelector('img');

          if (name && name.length > 2) {
            results.push({
              name: name,
              cuisine: cuisineEl?.textContent?.trim() || '',
              rating: ratingEl?.textContent?.trim() || '',
              address: addressEl?.textContent?.trim() || '',
              delivery_time: timeEl?.textContent?.trim() || '',
              image: imageEl?.src || '',
              platform: 'Swiggy',
              scraped_at: new Date().toISOString()
            });
          }
        } catch (err) {
          console.log(`Error processing element ${index}:`, err.message);
        }
      });

      return results;
    });

    log(`✅ Found ${restaurants.length} restaurants on Swiggy in ${city}`);
    return restaurants.map(r => ({ ...r, city }));

  } catch (error) {
    log(`❌ Error scraping Swiggy ${city}: ${error.message}`, 'ERROR');
    return [];
  } finally {
    await browser.close();
  }
}

// Main scraping function
async function scrapeRestaurants() {
  log('🚀 Starting web scraping of food delivery platforms...');

  const allRestaurants = [];

  for (const city of CONFIG.CITIES) {
    log(`\n🏙️  Processing city: ${city.toUpperCase()}`);

    try {
      // Scrape Zomato
      const zomatoData = await scrapeZomato(city);
      allRestaurants.push(...zomatoData);

      await wait(2000); // Delay between platforms

      // Scrape Swiggy (skip Dubai as it's not available)
      if (city !== 'dubai') {
        const swiggyData = await scrapeSwiggy(city);
        allRestaurants.push(...swiggyData);

        await wait(3000); // Delay between cities
      }
    } catch (error) {
      log(`❌ Error processing ${city}: ${error.message}`, 'ERROR');
    }
  }

  // Save results
  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `scraped_restaurants_${timestamp}.json`;

  await fs.writeFile(filename, JSON.stringify(allRestaurants, null, 2));

  log(`\n📁 Saved ${allRestaurants.length} restaurants to ${filename}`);

  // Summary by platform and city
  const summary = {};
  allRestaurants.forEach(r => {
    const key = `${r.city}_${r.platform}`;
    summary[key] = (summary[key] || 0) + 1;
  });

  log('\n📊 Summary:');
  Object.entries(summary).forEach(([key, count]) => {
    log(`   ${key}: ${count} restaurants`);
  });

  log('🎉 Scraping completed!');
  return allRestaurants;
}

// Test function to scrape specific menus
async function scrapeMenuSample() {
  log('🍽️  Testing menu scraping...');

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    // Try a sample restaurant page (this would need specific URLs in real implementation)
    const testUrl = 'https://www.zomato.com/mumbai/restaurants';
    await page.goto(testUrl, { waitUntil: 'networkidle2' });

    log('✅ Menu scraping test completed');

  } catch (error) {
    log(`❌ Menu scraping test failed: ${error.message}`, 'ERROR');
  } finally {
    await browser.close();
  }
}

// Main function
async function main() {
  const command = process.argv[2];

  switch (command) {
    case 'restaurants':
      await scrapeRestaurants();
      break;

    case 'menus':
      await scrapeMenuSample();
      break;

    case 'all':
      await scrapeRestaurants();
      await wait(5000);
      await scrapeMenuSample();
      break;

    default:
      console.log(`
🤖 NutriAI Web Scraper

Usage:
  node web-scraper.js restaurants  - Scrape restaurant listings
  node web-scraper.js menus       - Test menu scraping
  node web-scraper.js all         - Run both

Features:
- Scrapes Zomato and Swiggy without APIs
- Uses stealth mode to avoid detection
- Outputs to JSON files
- Handles multiple cities

Cities: Mumbai, Delhi, Bangalore, Dubai
      `);
      break;
  }
}

// Handle errors
process.on('uncaughtException', (error) => {
  log(`💥 Uncaught Exception: ${error.message}`, 'FATAL');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  log(`💥 Unhandled Rejection: ${reason}`, 'FATAL');
  process.exit(1);
});

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { scrapeRestaurants, scrapeMenuSample };