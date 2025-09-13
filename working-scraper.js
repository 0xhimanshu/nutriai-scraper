#!/usr/bin/env node

/**
 * Working NutriAI Restaurant Scraper
 * Uses actual website structures found in debugging
 */

require('dotenv').config({ quiet: true });
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises;

puppeteer.use(StealthPlugin());

// Logging function
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${message}`);
}

// Wait function
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Scrape restaurants from various food websites
async function scrapeRestaurants() {
  log('🚀 Starting restaurant scraping...');

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const allRestaurants = [];

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    // Test multiple food delivery platforms
    const sites = [
      {
        name: 'Zomato Mumbai',
        url: 'https://www.zomato.com/mumbai/restaurants',
        city: 'Mumbai'
      },
      {
        name: 'Zomato Delhi',
        url: 'https://www.zomato.com/ncr/restaurants',
        city: 'Delhi'
      }
    ];

    for (const site of sites) {
      try {
        log(`🏙️  Scraping ${site.name}...`);

        await page.goto(site.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await wait(4000);

        // Scroll to load more content
        await page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight * 0.3);
        });
        await wait(2000);

        const restaurants = await page.evaluate((cityName) => {
          const results = [];

          // Try to find restaurant data by looking for text patterns
          const allElements = document.querySelectorAll('div, section, article');

          allElements.forEach((element, index) => {
            if (index > 1000) return; // Limit processing

            const text = element.innerText?.trim() || '';
            const textLower = text.toLowerCase();

            // Look for restaurant-like patterns
            if (text.length > 10 && text.length < 200) {
              const hasRestaurantKeywords = /restaurant|cuisine|food|cafe|bar|grill|kitchen|deli|bistro|pizza|burger/i.test(text);
              const hasRating = /\d+\.\d+|\d+\/\d+|★|⭐/i.test(text);
              const hasCuisine = /indian|chinese|italian|mexican|thai|american|continental|fast food|south indian|north indian|punjabi|gujarati|maharashtrian/i.test(text);

              if ((hasRestaurantKeywords || hasCuisine) && text.split('\\n').length <= 5) {
                // Try to extract name (usually first line or prominent text)
                const lines = text.split('\\n').filter(line => line.trim().length > 0);
                const name = lines[0] || text.substring(0, 50);

                // Skip if it's clearly not a restaurant name
                if (!/login|sign up|order now|delivery|search|home|menu|cart|about|contact|^\\d+$|^[a-z]$/i.test(name)) {
                  const rating = text.match(/(\d+\.\d+)/)?.[1] || '';
                  const cuisine = text.match(/(indian|chinese|italian|mexican|thai|american|continental|fast food|south indian|north indian|punjabi|gujarati|maharashtrian)/i)?.[1] || '';

                  results.push({
                    name: name.substring(0, 100),
                    text: text.substring(0, 150),
                    rating: rating,
                    cuisine: cuisine,
                    city: cityName,
                    platform: 'Zomato',
                    scraped_at: new Date().toISOString()
                  });
                }
              }
            }
          });

          // Remove duplicates based on name similarity
          const unique = [];
          results.forEach(restaurant => {
            const isDuplicate = unique.some(existing =>
              existing.name.toLowerCase().includes(restaurant.name.toLowerCase().substring(0, 10)) ||
              restaurant.name.toLowerCase().includes(existing.name.toLowerCase().substring(0, 10))
            );
            if (!isDuplicate && restaurant.name.length > 3) {
              unique.push(restaurant);
            }
          });

          return unique.slice(0, 50); // Limit results

        }, site.city);

        log(`✅ Found ${restaurants.length} restaurants from ${site.name}`);
        allRestaurants.push(...restaurants);

        await wait(3000); // Delay between sites

      } catch (error) {
        log(`❌ Error scraping ${site.name}: ${error.message}`, 'ERROR');
      }
    }

    // Try OpenTable or other restaurant listing sites
    try {
      log('🍽️  Trying alternative food sites...');

      // Try a simpler approach with a food blog or directory
      await page.goto('https://www.timeout.com/mumbai/restaurants', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await wait(3000);

      const timeoutRestaurants = await page.evaluate(() => {
        const results = [];
        const headings = document.querySelectorAll('h1, h2, h3, h4');

        headings.forEach(heading => {
          const text = heading.innerText?.trim();
          if (text && text.length > 5 && text.length < 80) {
            // Look for restaurant names in headings
            const hasRestaurantWords = /restaurant|cafe|bar|kitchen|grill|bistro|pizza|burger|indian|chinese|italian/i.test(text);
            const parentText = heading.parentElement?.innerText?.trim() || '';

            if (hasRestaurantWords || /mumbai|food|menu|cuisine/i.test(parentText)) {
              results.push({
                name: text,
                city: 'Mumbai',
                platform: 'TimeOut',
                source: 'heading',
                scraped_at: new Date().toISOString()
              });
            }
          }
        });

        return results.slice(0, 20);
      });

      log(`✅ Found ${timeoutRestaurants.length} restaurants from TimeOut`);
      allRestaurants.push(...timeoutRestaurants);

    } catch (error) {
      log(`❌ Error scraping alternative sites: ${error.message}`, 'ERROR');
    }

  } catch (error) {
    log(`❌ General scraping error: ${error.message}`, 'ERROR');
  } finally {
    await browser.close();
  }

  // Save results
  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `restaurants_scraped_${timestamp}.json`;

  await fs.writeFile(filename, JSON.stringify(allRestaurants, null, 2));

  // Summary
  log(`\\n📁 Saved ${allRestaurants.length} restaurants to ${filename}`);

  const summary = {};
  allRestaurants.forEach(r => {
    const key = `${r.city}_${r.platform}`;
    summary[key] = (summary[key] || 0) + 1;
  });

  log('\\n📊 Summary by source:');
  Object.entries(summary).forEach(([key, count]) => {
    log(`   ${key}: ${count} restaurants`);
  });

  if (allRestaurants.length > 0) {
    log('\\n🍽️  Sample restaurants found:');
    allRestaurants.slice(0, 5).forEach((restaurant, idx) => {
      log(`   ${idx + 1}. ${restaurant.name} (${restaurant.city} - ${restaurant.platform})`);
    });
  }

  log('🎉 Scraping completed!');
  return allRestaurants;
}

// Main function
async function main() {
  const command = process.argv[2];

  switch (command) {
    case 'restaurants':
      await scrapeRestaurants();
      break;

    default:
      console.log(`
🤖 Working Restaurant Scraper

Usage:
  node working-scraper.js restaurants

Features:
- Scrapes restaurant data from multiple food sites
- Uses text pattern recognition instead of fragile CSS selectors
- Outputs to JSON files
- Handles multiple cities

This version is designed to work even when website layouts change.
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

module.exports = { scrapeRestaurants };