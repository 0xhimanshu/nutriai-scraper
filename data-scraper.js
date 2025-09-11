#!/usr/bin/env node

/**
 * NutriAI Data Scraper
 * Independent script to collect restaurant and menu data globally
 * Run this separately: node scripts/data-scraper.js
 */

const mysql = require('mysql2/promise');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Enable stealth mode to avoid detection
puppeteer.use(StealthPlugin());

// Configuration - Update with your API keys
const CONFIG = {
  // Database connection
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_USER: process.env.DB_USER || 'root', 
  DB_PASSWORD: process.env.DB_PASSWORD || '',
  DB_NAME: process.env.DB_NAME || 'nutriai_dev',
  
  // API Keys - Add your actual keys
  GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY || 'YOUR_GOOGLE_PLACES_API_KEY',
  TWOCAPTCHA_API_KEY: process.env.TWOCAPTCHA_API_KEY || '', // For CAPTCHA solving
  
  // Scraping settings
  CITIES: [
    // India
    { name: 'Mumbai', country: 'India', lat: 19.0760, lng: 72.8777 },
    { name: 'Delhi', country: 'India', lat: 28.7041, lng: 77.1025 },
    { name: 'Bangalore', country: 'India', lat: 12.9716, lng: 77.5946 },
    { name: 'Chennai', country: 'India', lat: 13.0827, lng: 80.2707 },
    { name: 'Hyderabad', country: 'India', lat: 17.3850, lng: 78.4867 },
    { name: 'Pune', country: 'India', lat: 18.5204, lng: 73.8567 },
    
    // UAE
    { name: 'Dubai', country: 'UAE', lat: 25.2048, lng: 55.2708 },
    { name: 'Abu Dhabi', country: 'UAE', lat: 24.4539, lng: 54.3773 },
    { name: 'Sharjah', country: 'UAE', lat: 25.3573, lng: 55.4033 },
    
    // USA (Major cities)
    { name: 'New York', country: 'USA', lat: 40.7128, lng: -74.0060 },
    { name: 'Los Angeles', country: 'USA', lat: 34.0522, lng: -118.2437 },
    { name: 'Chicago', country: 'USA', lat: 41.8781, lng: -87.6298 },
    
    // UK
    { name: 'London', country: 'UK', lat: 51.5074, lng: -0.1278 },
    { name: 'Manchester', country: 'UK', lat: 53.4808, lng: -2.2426 },
    
    // Add more cities as needed...
  ],
  
  CUISINE_TYPES: [
    'indian', 'chinese', 'italian', 'mexican', 'thai', 'japanese', 
    'american', 'mediterranean', 'middle_eastern', 'fast_food',
    'vegetarian', 'vegan', 'healthy', 'pizza', 'burger', 'sushi'
  ],
  
  // Rate limiting
  DELAY_BETWEEN_REQUESTS: 1000, // 1 second between API calls
  BATCH_SIZE: 20 // Process 20 restaurants at a time
};

// Global database connection
let db = null;

// Logging utility
const log = (message, level = 'INFO') => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${message}`);
};

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
    return db;
  } catch (error) {
    log(`❌ Database connection failed: ${error.message}`, 'ERROR');
    process.exit(1);
  }
}

// Create scraping job record
async function createScrapingJob(jobType, config) {
  try {
    const [result] = await db.execute(
      `INSERT INTO scraping_jobs (job_type, job_config, status) VALUES (?, ?, 'running')`,
      [jobType, JSON.stringify(config)]
    );
    
    log(`📋 Created scraping job #${result.insertId} for ${jobType}`);
    return result.insertId;
  } catch (error) {
    log(`❌ Failed to create scraping job: ${error.message}`, 'ERROR');
    throw error;
  }
}

// Update scraping job progress
async function updateScrapingJob(jobId, status, progress = 0, results = null) {
  try {
    await db.execute(
      `UPDATE scraping_jobs SET status = ?, progress_percentage = ?, 
       results_summary = ?, completed_at = ? WHERE id = ?`,
      [
        status, 
        progress, 
        results ? JSON.stringify(results) : null,
        status === 'completed' ? new Date() : null,
        jobId
      ]
    );
  } catch (error) {
    log(`❌ Failed to update job ${jobId}: ${error.message}`, 'ERROR');
  }
}

// Google Places API - Find restaurants by location
async function findRestaurantsByLocation(city) {
  const url = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json';
  
  const restaurants = [];
  let nextPageToken = null;
  
  do {
    try {
      const params = {
        location: `${city.lat},${city.lng}`,
        radius: 10000, // 10km radius
        type: 'restaurant',
        key: CONFIG.GOOGLE_PLACES_API_KEY
      };
      
      if (nextPageToken) {
        params.pagetoken = nextPageToken;
        // Required delay for next page token
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      const response = await axios.get(url, { params });
      
      if (response.data.status !== 'OK' && response.data.status !== 'ZERO_RESULTS') {
        throw new Error(`Google Places API error: ${response.data.status}`);
      }
      
      const results = response.data.results || [];
      restaurants.push(...results);
      
      nextPageToken = response.data.next_page_token;
      
      log(`📍 Found ${results.length} restaurants in ${city.name} (Total: ${restaurants.length})`);
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY_BETWEEN_REQUESTS));
      
    } catch (error) {
      log(`❌ Error fetching restaurants for ${city.name}: ${error.message}`, 'ERROR');
      break;
    }
  } while (nextPageToken);
  
  return restaurants;
}

// Get detailed restaurant information
async function getRestaurantDetails(placeId) {
  const url = 'https://maps.googleapis.com/maps/api/place/details/json';
  
  try {
    const response = await axios.get(url, {
      params: {
        place_id: placeId,
        fields: 'name,formatted_address,formatted_phone_number,website,rating,price_level,opening_hours,photos,reviews,types,geometry',
        key: CONFIG.GOOGLE_PLACES_API_KEY
      }
    });
    
    if (response.data.status !== 'OK') {
      throw new Error(`Details API error: ${response.data.status}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY_BETWEEN_REQUESTS));
    
    return response.data.result;
  } catch (error) {
    log(`❌ Error fetching details for place ${placeId}: ${error.message}`, 'ERROR');
    return null;
  }
}

// Save restaurant to database
async function saveRestaurant(restaurantData, city) {
  try {
    const [existing] = await db.execute(
      'SELECT id FROM restaurants WHERE google_place_id = ?',
      [restaurantData.place_id]
    );
    
    if (existing.length > 0) {
      log(`⚠️  Restaurant ${restaurantData.name} already exists, skipping`);
      return existing[0].id;
    }
    
    // Extract cuisine type from Google Places types
    const cuisineType = restaurantData.types?.find(type => 
      CONFIG.CUISINE_TYPES.includes(type)
    ) || 'restaurant';
    
    // Prepare restaurant data
    const insertData = {
      name: restaurantData.name,
      cuisine_type: cuisineType,
      city: city.name,
      country: city.country,
      address: restaurantData.formatted_address,
      phone: restaurantData.formatted_phone_number,
      website: restaurantData.website,
      google_place_id: restaurantData.place_id,
      latitude: restaurantData.geometry?.location?.lat,
      longitude: restaurantData.geometry?.location?.lng,
      rating: restaurantData.rating || 0,
      price_range: restaurantData.price_level || 2,
      dietary_options: JSON.stringify([]),
      delivery_available: true,
      delivery_platforms: JSON.stringify([]),
      operating_hours: JSON.stringify(restaurantData.opening_hours || {}),
      image_urls: JSON.stringify(restaurantData.photos?.map(photo => 
        `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${photo.photo_reference}&key=${CONFIG.GOOGLE_PLACES_API_KEY}`
      ) || []),
      last_scraped: new Date()
    };
    
    const [result] = await db.execute(
      `INSERT INTO restaurants (
        name, cuisine_type, city, country, address, phone, website, 
        google_place_id, latitude, longitude, rating, price_range,
        dietary_options, delivery_available, delivery_platforms, 
        operating_hours, image_urls, last_scraped
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      Object.values(insertData)
    );
    
    log(`✅ Saved restaurant: ${restaurantData.name} (ID: ${result.insertId})`);
    return result.insertId;
    
  } catch (error) {
    log(`❌ Failed to save restaurant ${restaurantData.name}: ${error.message}`, 'ERROR');
    throw error;
  }
}

// Main scraping function
async function scrapeRestaurantData() {
  log('🚀 Starting NutriAI restaurant data scraping...');
  
  // Connect to database
  await connectDatabase();
  
  // Create scraping job
  const jobId = await createScrapingJob('google_places', {
    cities: CONFIG.CITIES.length,
    cuisines: CONFIG.CUISINE_TYPES
  });
  
  let totalRestaurants = 0;
  let totalProcessed = 0;
  
  try {
    // Process each city
    for (let i = 0; i < CONFIG.CITIES.length; i++) {
      const city = CONFIG.CITIES[i];
      log(`🌍 Processing city: ${city.name}, ${city.country}`);
      
      // Find restaurants in this city
      const restaurants = await findRestaurantsByLocation(city);
      totalRestaurants += restaurants.length;
      
      // Process restaurants in batches
      for (let j = 0; j < restaurants.length; j += CONFIG.BATCH_SIZE) {
        const batch = restaurants.slice(j, j + CONFIG.BATCH_SIZE);
        
        for (const restaurant of batch) {
          try {
            // Get detailed information
            const details = await getRestaurantDetails(restaurant.place_id);
            if (details) {
              await saveRestaurant(details, city);
              totalProcessed++;
            }
          } catch (error) {
            log(`❌ Error processing restaurant: ${error.message}`, 'ERROR');
          }
        }
        
        // Update progress
        const progress = Math.round((totalProcessed / totalRestaurants) * 100);
        await updateScrapingJob(jobId, 'running', progress);
        
        log(`📊 Progress: ${totalProcessed}/${totalRestaurants} (${progress}%)`);
      }
    }
    
    // Complete the job
    await updateScrapingJob(jobId, 'completed', 100, {
      restaurants_found: totalRestaurants,
      restaurants_saved: totalProcessed,
      cities_processed: CONFIG.CITIES.length
    });
    
    log(`🎉 Scraping completed! Processed ${totalProcessed}/${totalRestaurants} restaurants`);
    
  } catch (error) {
    log(`❌ Scraping failed: ${error.message}`, 'ERROR');
    await updateScrapingJob(jobId, 'failed', 0, { error: error.message });
  } finally {
    if (db) {
      await db.end();
      log('📔 Database connection closed');
    }
  }
}

// CAPTCHA solving utility using 2captcha service
async function solveCaptcha(siteKey, pageUrl, captchaType = 'recaptchav2') {
  if (!CONFIG.TWOCAPTCHA_API_KEY) {
    log('⚠️  No 2captcha API key provided, skipping CAPTCHA solving', 'WARN');
    return null;
  }

  try {
    log('🧩 Solving CAPTCHA...');
    
    // Submit CAPTCHA for solving
    const submitResponse = await axios.post(`http://2captcha.com/in.php`, {
      key: CONFIG.TWOCAPTCHA_API_KEY,
      method: captchaType,
      googlekey: siteKey,
      pageurl: pageUrl
    });

    if (!submitResponse.data.startsWith('OK|')) {
      throw new Error(`CAPTCHA submission failed: ${submitResponse.data}`);
    }

    const captchaId = submitResponse.data.split('|')[1];
    log(`🎯 CAPTCHA submitted with ID: ${captchaId}`);

    // Poll for solution (may take 10-120 seconds)
    for (let i = 0; i < 24; i++) { // Max 2 minutes
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
      
      const resultResponse = await axios.get(`http://2captcha.com/res.php?key=${CONFIG.TWOCAPTCHA_API_KEY}&action=get&id=${captchaId}`);
      
      if (resultResponse.data.startsWith('OK|')) {
        const solution = resultResponse.data.split('|')[1];
        log('✅ CAPTCHA solved successfully');
        return solution;
      }
      
      if (resultResponse.data !== 'CAPCHA_NOT_READY') {
        throw new Error(`CAPTCHA solving failed: ${resultResponse.data}`);
      }
    }
    
    throw new Error('CAPTCHA solving timeout');
    
  } catch (error) {
    log(`❌ CAPTCHA solving error: ${error.message}`, 'ERROR');
    return null;
  }
}

// Scrape Zomato restaurant menus (with CAPTCHA handling)
async function scrapeZomatoMenus(restaurantUrl) {
  const browser = await puppeteer.launch({ 
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-zygote',
      '--disable-gpu'
    ]
  });

  try {
    const page = await browser.newPage();
    
    // Set realistic viewport and user agent
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    log(`🌐 Navigating to: ${restaurantUrl}`);
    await page.goto(restaurantUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Check for CAPTCHA
    const captchaElement = await page.$('[data-sitekey], .g-recaptcha, #captcha');
    
    if (captchaElement) {
      log('🚨 CAPTCHA detected on page');
      
      // Extract site key
      const siteKey = await page.evaluate(() => {
        const element = document.querySelector('[data-sitekey]');
        return element ? element.getAttribute('data-sitekey') : null;
      });
      
      if (siteKey) {
        const solution = await solveCaptcha(siteKey, restaurantUrl);
        
        if (solution) {
          // Inject CAPTCHA solution
          await page.evaluate((token) => {
            document.getElementById('g-recaptcha-response').innerHTML = token;
            if (typeof grecaptcha !== 'undefined') {
              grecaptcha.getResponse = () => token;
            }
          }, solution);
          
          // Submit form or click continue
          await page.click('button[type="submit"], .captcha-submit, #submit-btn');
          await page.waitForNavigation({ waitUntil: 'networkidle2' });
          
          log('✅ CAPTCHA bypassed successfully');
        } else {
          log('❌ Failed to solve CAPTCHA, skipping this restaurant');
          return [];
        }
      }
    }
    
    // Wait for menu to load
    await page.waitForSelector('.menu-item, .dish-item, [data-testid="menu-item"]', { timeout: 10000 });
    
    // Extract menu items
    const menuItems = await page.evaluate(() => {
      const items = [];
      const menuElements = document.querySelectorAll('.menu-item, .dish-item, [data-testid="menu-item"]');
      
      menuElements.forEach(element => {
        const name = element.querySelector('.dish-name, .item-name, h3, h4')?.textContent?.trim();
        const price = element.querySelector('.price, .dish-price, [data-testid="price"]')?.textContent?.trim();
        const description = element.querySelector('.description, .dish-description')?.textContent?.trim();
        const image = element.querySelector('img')?.src;
        
        if (name) {
          items.push({
            name,
            price: price ? parseFloat(price.replace(/[^\d.]/g, '')) : null,
            description: description || '',
            image: image || '',
            category: 'main' // Default category
          });
        }
      });
      
      return items;
    });
    
    log(`📋 Extracted ${menuItems.length} menu items`);
    return menuItems;
    
  } catch (error) {
    log(`❌ Error scraping Zomato menu: ${error.message}`, 'ERROR');
    return [];
  } finally {
    await browser.close();
  }
}

// Main menu scraping function with platform detection
async function scrapeMenuData() {
  log('🍽️  Starting menu data scraping...');
  
  await connectDatabase();
  
  // Get restaurants that need menu scraping
  const [restaurants] = await db.execute(`
    SELECT id, name, website, city, country 
    FROM restaurants 
    WHERE website IS NOT NULL 
    AND last_scraped IS NULL 
    LIMIT 50
  `);
  
  const jobId = await createScrapingJob('menu_scraping', {
    restaurants_count: restaurants.length,
    platforms: ['zomato', 'swiggy', 'talabat', 'doordash']
  });
  
  let processed = 0;
  
  for (const restaurant of restaurants) {
    try {
      log(`🏪 Processing: ${restaurant.name} - ${restaurant.website}`);
      
      let menuItems = [];
      
      // Platform-specific scraping
      if (restaurant.website.includes('zomato.com')) {
        menuItems = await scrapeZomatoMenus(restaurant.website);
      } else if (restaurant.website.includes('swiggy.com')) {
        // TODO: Implement Swiggy scraping
        log('📝 Swiggy scraping not implemented yet');
      } else if (restaurant.website.includes('talabat.com')) {
        // TODO: Implement Talabat scraping  
        log('📝 Talabat scraping not implemented yet');
      } else {
        log(`⚠️  Unknown platform for ${restaurant.website}`);
        continue;
      }
      
      // Save menu items to database
      for (const item of menuItems) {
        await db.execute(`
          INSERT INTO menu_items (
            restaurant_id, name, description, price, category, 
            ingredients, image_urls, last_scraped
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          restaurant.id,
          item.name,
          item.description,
          item.price,
          item.category,
          JSON.stringify([]), // TODO: Extract ingredients
          JSON.stringify([item.image]),
          new Date()
        ]);
      }
      
      // Update restaurant scraping timestamp
      await db.execute(
        'UPDATE restaurants SET last_scraped = ? WHERE id = ?',
        [new Date(), restaurant.id]
      );
      
      processed++;
      const progress = Math.round((processed / restaurants.length) * 100);
      await updateScrapingJob(jobId, 'running', progress);
      
      log(`✅ Processed ${restaurant.name}: ${menuItems.length} menu items`);
      
      // Rate limiting between restaurants
      await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY_BETWEEN_REQUESTS * 2));
      
    } catch (error) {
      log(`❌ Error processing ${restaurant.name}: ${error.message}`, 'ERROR');
    }
  }
  
  await updateScrapingJob(jobId, 'completed', 100, {
    restaurants_processed: processed,
    total_restaurants: restaurants.length
  });
  
  log(`🎉 Menu scraping completed! Processed ${processed}/${restaurants.length} restaurants`);
}

// CLI Interface
async function main() {
  const command = process.argv[2];
  
  switch (command) {
    case 'restaurants':
      await scrapeRestaurantData();
      break;
    case 'menus':
      await scrapeMenuData();
      break;
    case 'all':
      await scrapeRestaurantData();
      await scrapeMenuData();
      break;
    default:
      console.log(`
🤖 NutriAI Data Scraper

Usage:
  node scripts/data-scraper.js <command>

Commands:
  restaurants  - Scrape restaurant data using Google Places API
  menus        - Scrape menu data from delivery platforms
  all          - Run both restaurant and menu scraping

Setup:
  1. Add your API keys to .env file:
     GOOGLE_PLACES_API_KEY=your_key_here
  
  2. Make sure MySQL is running with nutriai_dev database
  
  3. Run: node scripts/data-scraper.js restaurants

⚠️  Note: This will make many API calls. Monitor your quota!
      `);
      break;
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  log(`💥 Uncaught Exception: ${error.message}`, 'FATAL');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  log(`💥 Unhandled Rejection at: ${promise} reason: ${reason}`, 'FATAL');
  process.exit(1);
});

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { scrapeRestaurantData, scrapeMenuData };