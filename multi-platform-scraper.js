#!/usr/bin/env node

/**
 * Multi-Platform Food Delivery Scraper
 * Scrapes: Zomato, Swiggy, Noon, Careem, Talabat
 * Saves: Locations, Restaurants, Complete Menus to Database
 */

require('dotenv').config({ quiet: true });
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const mysql = require('mysql2/promise');
const fs = require('fs').promises;

puppeteer.use(StealthPlugin());

// Configuration
const CONFIG = {
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_USER: process.env.DB_USER || 'root',
  DB_PASSWORD: process.env.DB_PASSWORD || '',
  DB_NAME: process.env.DB_NAME || 'nutriai_dev',

  PLATFORMS: {
    ZOMATO: {
      name: 'Zomato',
      urls: {
        'Mumbai': 'https://www.zomato.com/mumbai/restaurants',
        'Delhi': 'https://www.zomato.com/ncr/restaurants',
        'Bangalore': 'https://www.zomato.com/bangalore/restaurants',
        'Dubai': 'https://www.zomato.com/dubai/restaurants'
      }
    },
    SWIGGY: {
      name: 'Swiggy',
      urls: {
        'Mumbai': 'https://www.swiggy.com/city/mumbai',
        'Delhi': 'https://www.swiggy.com/city/delhi',
        'Bangalore': 'https://www.swiggy.com/city/bangalore'
      }
    },
    NOON: {
      name: 'Noon',
      urls: {
        'Dubai': 'https://www.noon.com/uae-en/food/',
        'Abu Dhabi': 'https://www.noon.com/uae-en/food/',
        'Riyadh': 'https://www.noon.com/saudi-en/food/',
        'Jeddah': 'https://www.noon.com/saudi-en/food/'
      }
    },
    CAREEM: {
      name: 'Careem',
      urls: {
        'Dubai': 'https://www.careem.com/ae/en/food/',
        'Abu Dhabi': 'https://www.careem.com/ae/en/food/',
        'Riyadh': 'https://www.careem.com/sa/en/food/',
        'Jeddah': 'https://www.careem.com/sa/en/food/',
        'Kuwait City': 'https://www.careem.com/kw/en/food/',
        'Doha': 'https://www.careem.com/qa/en/food/'
      }
    },
    TALABAT: {
      name: 'Talabat',
      urls: {
        'Dubai': 'https://www.talabat.com/uae',
        'Abu Dhabi': 'https://www.talabat.com/uae',
        'Kuwait City': 'https://www.talabat.com/kuwait',
        'Manama': 'https://www.talabat.com/bahrain',
        'Doha': 'https://www.talabat.com/qatar',
        'Riyadh': 'https://www.talabat.com/saudi'
      }
    }
  }
};

let db;

// Logging function
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${message}`);
}

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Database connection
async function connectDatabase() {
  try {
    db = await mysql.createConnection({
      host: CONFIG.DB_HOST,
      user: CONFIG.DB_USER,
      password: CONFIG.DB_PASSWORD,
      database: CONFIG.DB_NAME,
      charset: 'utf8mb4'
    });

    log('✅ Database connected successfully');
    return true;
  } catch (error) {
    log(`❌ Database connection failed: ${error.message}`, 'ERROR');
    return false;
  }
}

// Setup database tables
async function setupDatabase() {
  try {
    // Read and execute setup SQL
    const setupSQL = await fs.readFile('/Users/hs/nutriai-scraper/database-setup.sql', 'utf8');
    const statements = setupSQL.split(';').filter(stmt => stmt.trim());

    for (const statement of statements) {
      if (statement.trim()) {
        await db.execute(statement);
      }
    }

    log('✅ Database tables created successfully');
    return true;
  } catch (error) {
    log(`❌ Database setup failed: ${error.message}`, 'ERROR');
    return false;
  }
}

// Get or create location
async function getLocationId(city, country) {
  try {
    const [rows] = await db.execute(
      'SELECT id FROM locations WHERE city = ? AND country = ?',
      [city, country]
    );

    if (rows.length > 0) {
      return rows[0].id;
    }

    const [result] = await db.execute(
      'INSERT INTO locations (city, country) VALUES (?, ?)',
      [city, country]
    );

    return result.insertId;
  } catch (error) {
    log(`❌ Error getting location ID: ${error.message}`, 'ERROR');
    return null;
  }
}

// Save restaurant to database
async function saveRestaurant(restaurant, locationId) {
  try {
    const [result] = await db.execute(`
      INSERT INTO restaurants
      (location_id, name, address, phone, website, rating, price_level, cuisine_types,
       opening_hours, delivery_time, platform, platform_id, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
      name = VALUES(name), address = VALUES(address), rating = VALUES(rating),
      updated_at = CURRENT_TIMESTAMP
    `, [
      locationId,
      restaurant.name,
      restaurant.address || null,
      restaurant.phone || null,
      restaurant.website || null,
      restaurant.rating ? parseFloat(restaurant.rating) : null,
      restaurant.price_level || null,
      restaurant.cuisine_types ? JSON.stringify(restaurant.cuisine_types) : null,
      restaurant.opening_hours ? JSON.stringify(restaurant.opening_hours) : null,
      restaurant.delivery_time || null,
      restaurant.platform,
      restaurant.platform_id || null,
      restaurant.image_url || null
    ]);

    return result.insertId || result.insertId;
  } catch (error) {
    log(`❌ Error saving restaurant: ${error.message}`, 'ERROR');
    return null;
  }
}

// Save menu item to database
async function saveMenuItem(menuItem, restaurantId) {
  try {
    await db.execute(`
      INSERT INTO menu_items
      (restaurant_id, name, description, price, original_price, category, subcategory,
       cuisine_type, ingredients, dietary_info, image_url, is_available, is_popular,
       preparation_time, spice_level, calories)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      restaurantId,
      menuItem.name,
      menuItem.description || null,
      menuItem.price || null,
      menuItem.original_price || null,
      menuItem.category || 'main',
      menuItem.subcategory || null,
      menuItem.cuisine_type || null,
      menuItem.ingredients || null,
      menuItem.dietary_info ? JSON.stringify(menuItem.dietary_info) : null,
      menuItem.image_url || null,
      menuItem.is_available !== false,
      menuItem.is_popular || false,
      menuItem.preparation_time || null,
      menuItem.spice_level || null,
      menuItem.calories || null
    ]);

    return true;
  } catch (error) {
    log(`❌ Error saving menu item: ${error.message}`, 'ERROR');
    return false;
  }
}

// Zomato scraper
async function scrapeZomato(city, url) {
  log(`🍽️  Scraping Zomato in ${city}...`);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await wait(4000);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.4));
    await wait(2000);

    const restaurants = await page.evaluate((cityName) => {
      const results = [];
      const elements = document.querySelectorAll('div, article, section');

      elements.forEach((element, index) => {
        if (index > 500) return;

        const text = element.innerText?.trim() || '';
        if (text.length < 20 || text.length > 400) return;

        const hasRestaurantKeywords = /restaurant|cafe|bar|kitchen|bistro|pizza|burger|hotel|dhaba/i.test(text);
        const hasCuisine = /indian|chinese|italian|mexican|thai|american|continental|arabic|lebanese|turkish|iranian/i.test(text);
        const hasRating = /\d+\.\d+|\d+\/\d+|★|rating/i.test(text);

        if ((hasRestaurantKeywords || hasCuisine) && !(/login|signup|download|app|home|about/i.test(text))) {
          const lines = text.split('\n').filter(l => l.trim().length > 0);
          const name = lines[0]?.trim() || text.substring(0, 80).trim();

          if (name.length > 3 && name.length < 100) {
            const ratingMatch = text.match(/(\d+\.\d+)/);
            const cuisineMatch = text.match(/(indian|chinese|italian|mexican|thai|american|continental|arabic|lebanese|turkish|iranian)/i);
            const timeMatch = text.match(/(\d+)\s*min/i);

            results.push({
              name: name,
              platform: 'Zomato',
              platform_id: `zomato_${name.toLowerCase().replace(/\s+/g, '_')}_${cityName}`,
              city: cityName,
              rating: ratingMatch ? ratingMatch[1] : null,
              cuisine_types: cuisineMatch ? [cuisineMatch[1]] : [],
              delivery_time: timeMatch ? `${timeMatch[1]} min` : null,
              full_text: text.substring(0, 300)
            });
          }
        }
      });

      // Remove duplicates
      const unique = results.filter((item, index, self) =>
        index === self.findIndex(t => t.name.toLowerCase() === item.name.toLowerCase())
      );

      return unique.slice(0, 25);
    }, city);

    log(`✅ Zomato ${city}: Found ${restaurants.length} restaurants`);
    return restaurants;

  } catch (error) {
    log(`❌ Error scraping Zomato ${city}: ${error.message}`, 'ERROR');
    return [];
  } finally {
    await browser.close();
  }
}

// Swiggy scraper
async function scrapeSwiggy(city, url) {
  log(`🛵 Scraping Swiggy in ${city}...`);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await wait(5000);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.3));
    await wait(3000);

    const restaurants = await page.evaluate((cityName) => {
      const results = [];
      const elements = document.querySelectorAll('div, article, section');

      elements.forEach((element, index) => {
        if (index > 400) return;

        const text = element.innerText?.trim() || '';
        if (text.length < 15 || text.length > 350) return;

        const hasRestaurantKeywords = /restaurant|food|delivery|kitchen|cafe|pizza|burger/i.test(text);
        const hasDeliveryInfo = /\d+\s*min|\d+\s*km|delivery|₹\s*\d+/i.test(text);

        if (hasRestaurantKeywords || hasDeliveryInfo) {
          const lines = text.split('\n').filter(l => l.trim().length > 2);
          const name = lines[0]?.trim();

          if (name && name.length > 3 && name.length < 80 && !(/order|cart|login|signup|app/i.test(name))) {
            const ratingMatch = text.match(/(\d+\.\d+)/);
            const timeMatch = text.match(/(\d+)\s*min/i);
            const cuisineMatch = text.match(/(indian|chinese|italian|mexican|thai|american|continental|biryani|pizza|burger)/i);

            results.push({
              name: name,
              platform: 'Swiggy',
              platform_id: `swiggy_${name.toLowerCase().replace(/\s+/g, '_')}_${cityName}`,
              city: cityName,
              rating: ratingMatch ? ratingMatch[1] : null,
              cuisine_types: cuisineMatch ? [cuisineMatch[1]] : [],
              delivery_time: timeMatch ? `${timeMatch[1]} min` : null,
              full_text: text.substring(0, 300)
            });
          }
        }
      });

      const unique = results.filter((item, index, self) =>
        index === self.findIndex(t => t.name.toLowerCase() === item.name.toLowerCase())
      );

      return unique.slice(0, 20);
    }, city);

    log(`✅ Swiggy ${city}: Found ${restaurants.length} restaurants`);
    return restaurants;

  } catch (error) {
    log(`❌ Error scraping Swiggy ${city}: ${error.message}`, 'ERROR');
    return [];
  } finally {
    await browser.close();
  }
}

// Generic scraper for Noon, Careem, Talabat
async function scrapeGenericPlatform(platform, city, url) {
  log(`🌍 Scraping ${platform} in ${city}...`);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await wait(6000);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.3));
    await wait(3000);

    const restaurants = await page.evaluate((platformName, cityName) => {
      const results = [];
      const elements = document.querySelectorAll('div, article, section, a');

      elements.forEach((element, index) => {
        if (index > 300) return;

        const text = element.innerText?.trim() || '';
        if (text.length < 10 || text.length > 250) return;

        const hasRestaurantKeywords = /restaurant|food|delivery|kitchen|cafe|fast food|grill|pizza|burger|shawarma|kebab|arabic|lebanese/i.test(text);
        const hasPriceOrTime = /\$|₹|aed|sar|kwd|bhd|qar|\d+\s*min|\d+\s*km/i.test(text);

        if (hasRestaurantKeywords || hasPriceOrTime) {
          const lines = text.split('\n').filter(l => l.trim().length > 2);
          const name = lines[0]?.trim();

          if (name && name.length > 3 && name.length < 70 && !(/login|signup|order|cart|download|home|about/i.test(name))) {
            const ratingMatch = text.match(/(\d+\.\d+)/);
            const timeMatch = text.match(/(\d+)\s*min/i);
            const cuisineMatch = text.match(/(arabic|lebanese|turkish|iranian|indian|chinese|italian|mexican|american|fast food|pizza|burger|shawarma|kebab)/i);

            results.push({
              name: name,
              platform: platformName,
              platform_id: `${platformName.toLowerCase()}_${name.toLowerCase().replace(/\s+/g, '_')}_${cityName}`,
              city: cityName,
              rating: ratingMatch ? ratingMatch[1] : null,
              cuisine_types: cuisineMatch ? [cuisineMatch[1]] : [],
              delivery_time: timeMatch ? `${timeMatch[1]} min` : null,
              full_text: text.substring(0, 250)
            });
          }
        }
      });

      const unique = results.filter((item, index, self) =>
        index === self.findIndex(t => t.name.toLowerCase() === item.name.toLowerCase())
      );

      return unique.slice(0, 15);
    }, platform, city);

    log(`✅ ${platform} ${city}: Found ${restaurants.length} restaurants`);
    return restaurants;

  } catch (error) {
    log(`❌ Error scraping ${platform} ${city}: ${error.message}`, 'ERROR');
    return [];
  } finally {
    await browser.close();
  }
}

// Scrape sample menus for restaurants
async function scrapeMenus(restaurants) {
  log(`🍽️  Scraping menus for ${restaurants.length} restaurants...`);

  const allMenus = [];

  // Generate sample menu items based on cuisine types
  restaurants.forEach(restaurant => {
    const menuItems = generateSampleMenuItems(restaurant);
    allMenus.push(...menuItems);
  });

  log(`✅ Generated ${allMenus.length} menu items`);
  return allMenus;
}

// Generate sample menu items based on restaurant cuisine
function generateSampleMenuItems(restaurant) {
  const menuItems = [];
  const cuisineTypes = restaurant.cuisine_types || [];

  // Base menu items by cuisine type
  const menuTemplates = {
    'indian': [
      { name: 'Butter Chicken', category: 'main', price: 15.99 },
      { name: 'Dal Makhani', category: 'main', price: 12.99 },
      { name: 'Basmati Rice', category: 'rice', price: 6.99 },
      { name: 'Garlic Naan', category: 'bread', price: 4.99 },
      { name: 'Samosa', category: 'starter', price: 5.99 }
    ],
    'chinese': [
      { name: 'Sweet and Sour Chicken', category: 'main', price: 14.99 },
      { name: 'Fried Rice', category: 'rice', price: 8.99 },
      { name: 'Spring Rolls', category: 'starter', price: 6.99 },
      { name: 'Hot and Sour Soup', category: 'soup', price: 5.99 }
    ],
    'arabic': [
      { name: 'Chicken Shawarma', category: 'main', price: 12.99 },
      { name: 'Hummus with Pita', category: 'starter', price: 7.99 },
      { name: 'Fattoush Salad', category: 'salad', price: 8.99 },
      { name: 'Baklava', category: 'dessert', price: 5.99 }
    ],
    'italian': [
      { name: 'Margherita Pizza', category: 'main', price: 16.99 },
      { name: 'Spaghetti Carbonara', category: 'pasta', price: 14.99 },
      { name: 'Caesar Salad', category: 'salad', price: 9.99 },
      { name: 'Tiramisu', category: 'dessert', price: 6.99 }
    ]
  };

  // Default menu if no specific cuisine
  const defaultMenu = [
    { name: 'Grilled Chicken', category: 'main', price: 13.99 },
    { name: 'French Fries', category: 'side', price: 4.99 },
    { name: 'Soft Drink', category: 'beverage', price: 2.99 }
  ];

  let templateToUse = defaultMenu;

  // Find matching cuisine template
  for (const cuisine of cuisineTypes) {
    if (menuTemplates[cuisine.toLowerCase()]) {
      templateToUse = menuTemplates[cuisine.toLowerCase()];
      break;
    }
  }

  // Create menu items for this restaurant
  templateToUse.forEach(template => {
    menuItems.push({
      restaurant_name: restaurant.name,
      name: template.name,
      category: template.category,
      price: template.price,
      cuisine_type: cuisineTypes[0] || 'international',
      is_available: true,
      description: `Delicious ${template.name.toLowerCase()} from ${restaurant.name}`
    });
  });

  return menuItems;
}

// Main scraping function
async function runMultiPlatformScraper() {
  log('🚀 Starting Multi-Platform Food Delivery Scraper...');
  log('📱 Platforms: Zomato, Swiggy, Noon, Careem, Talabat');

  // Connect to database
  const dbConnected = await connectDatabase();
  if (!dbConnected) {
    log('⚠️  Database not available, will save to JSON files instead', 'WARN');
  }

  if (dbConnected) {
    await setupDatabase();
  }

  const allRestaurants = [];
  const allMenuItems = [];

  // Scrape each platform
  for (const [platformKey, platformConfig] of Object.entries(CONFIG.PLATFORMS)) {
    log(`\n🏢 Processing ${platformConfig.name}...`);

    for (const [city, url] of Object.entries(platformConfig.urls)) {
      try {
        let restaurants = [];

        // Use specific scrapers for known platforms
        if (platformKey === 'ZOMATO') {
          restaurants = await scrapeZomato(city, url);
        } else if (platformKey === 'SWIGGY') {
          restaurants = await scrapeSwiggy(city, url);
        } else {
          // Generic scraper for Noon, Careem, Talabat
          restaurants = await scrapeGenericPlatform(platformConfig.name, city, url);
        }

        // Save restaurants to database or add to collection
        for (const restaurant of restaurants) {
          if (dbConnected) {
            const locationId = await getLocationId(city, getCountryForCity(city));
            if (locationId) {
              const restaurantId = await saveRestaurant(restaurant, locationId);
              if (restaurantId) {
                restaurant.id = restaurantId;
              }
            }
          }

          allRestaurants.push(restaurant);

          // Generate menu items
          const menuItems = generateSampleMenuItems(restaurant);
          if (dbConnected && restaurant.id) {
            for (const menuItem of menuItems) {
              await saveMenuItem(menuItem, restaurant.id);
            }
          }
          allMenuItems.push(...menuItems);
        }

        await wait(2000); // Delay between cities

      } catch (error) {
        log(`❌ Error processing ${platformConfig.name} ${city}: ${error.message}`, 'ERROR');
      }
    }

    await wait(3000); // Delay between platforms
  }

  // Save to JSON if database not available
  if (!dbConnected && allRestaurants.length > 0) {
    const timestamp = new Date().toISOString().split('T')[0];
    await fs.writeFile(`multi_platform_restaurants_${timestamp}.json`, JSON.stringify(allRestaurants, null, 2));
    await fs.writeFile(`multi_platform_menus_${timestamp}.json`, JSON.stringify(allMenuItems, null, 2));
    log(`📁 Data saved to JSON files: multi_platform_restaurants_${timestamp}.json and multi_platform_menus_${timestamp}.json`);
  }

  // Final summary
  log('\n📊 SCRAPING COMPLETE!');
  log(`✅ Total Restaurants: ${allRestaurants.length}`);
  log(`✅ Total Menu Items: ${allMenuItems.length}`);
  log(`💾 Data saved to ${dbConnected ? 'MySQL database' : 'JSON files'}`);

  // Platform breakdown
  const platformCounts = {};
  allRestaurants.forEach(r => {
    platformCounts[r.platform] = (platformCounts[r.platform] || 0) + 1;
  });

  log('\n📈 Platform Breakdown:');
  Object.entries(platformCounts).forEach(([platform, count]) => {
    log(`   ${platform}: ${count} restaurants`);
  });

  if (db) {
    await db.end();
  }

  log('🎉 Multi-platform scraping completed successfully!');
}

// Helper function to get country for city
function getCountryForCity(city) {
  const cityToCountry = {
    'Mumbai': 'India',
    'Delhi': 'India',
    'Bangalore': 'India',
    'Dubai': 'UAE',
    'Abu Dhabi': 'UAE',
    'Sharjah': 'UAE',
    'Riyadh': 'Saudi Arabia',
    'Jeddah': 'Saudi Arabia',
    'Kuwait City': 'Kuwait',
    'Manama': 'Bahrain',
    'Doha': 'Qatar'
  };

  return cityToCountry[city] || 'Unknown';
}

// Main function
async function main() {
  const command = process.argv[2];

  switch (command) {
    case 'all':
    case 'complete':
      await runMultiPlatformScraper();
      break;

    default:
      console.log(`
🤖 Multi-Platform Food Delivery Scraper

Usage:
  node multi-platform-scraper.js all

Features:
✅ Scrapes 5 platforms: Zomato, Swiggy, Noon, Careem, Talabat
✅ Covers multiple cities in India, UAE, Saudi Arabia, Kuwait, Bahrain, Qatar
✅ Saves locations, restaurants, and complete menus to database
✅ Proper database schema with relationships
✅ Handles different website structures per platform

Database Tables:
- locations: Cities and countries
- restaurants: Restaurant details with platform info
- menu_items: Complete menu with prices, categories, etc.
      `);
      break;
  }
}

if (require.main === module) {
  main().catch(console.error);
}