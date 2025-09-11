#!/usr/bin/env node

/**
 * NutriAI Universal Scraper - No API Dependencies
 * Pure website scraping with unlimited city support
 * Only requires Google Places API for restaurant discovery
 */

const mysql = require('mysql2/promise');
const axios = require('axios');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Enable stealth mode to avoid detection
puppeteer.use(StealthPlugin());

// Configuration
const CONFIG = {
  // Database connection
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_USER: process.env.DB_USER || 'root', 
  DB_PASSWORD: process.env.DB_PASSWORD || '',
  DB_NAME: process.env.DB_NAME || 'nutriai_dev',
  
  // Only Google Places API required (no platform APIs needed)
  GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY || '',
  TWOCAPTCHA_API_KEY: process.env.TWOCAPTCHA_API_KEY || '',
  
  // Scraping settings - UNLIMITED cities support
  DEFAULT_RADIUS: 15000, // 15km radius
  MAX_RESULTS_PER_CITY: 5000, // Max restaurants per city
  DELAY_BETWEEN_REQUESTS: 1000, // 1 second
  BATCH_SIZE: 20,
  
  // Popular cuisine types for comprehensive coverage
  CUISINE_TYPES: [
    'restaurant', 'meal_takeaway', 'meal_delivery', 'food',
    'bakery', 'cafe', 'bar', 'fast_food'
  ]
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

// Get coordinates for any city name using Google Geocoding
async function getCityCoordinates(cityName, countryName = '') {
  try {
    const query = countryName ? `${cityName}, ${countryName}` : cityName;
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${CONFIG.GOOGLE_PLACES_API_KEY}`;
    
    const response = await axios.get(url);
    
    if (response.data.status === 'OK' && response.data.results.length > 0) {
      const result = response.data.results[0];
      const location = result.geometry.location;
      
      // Extract country and admin area from address components
      let country = '';
      let adminArea = '';
      
      result.address_components.forEach(component => {
        if (component.types.includes('country')) {
          country = component.long_name;
        }
        if (component.types.includes('administrative_area_level_1')) {
          adminArea = component.long_name;
        }
      });
      
      return {
        name: cityName,
        country: country || countryName,
        state: adminArea,
        lat: location.lat,
        lng: location.lng,
        formatted_address: result.formatted_address
      };
    }
    
    throw new Error(`No results found for ${query}`);
    
  } catch (error) {
    log(`❌ Error geocoding ${cityName}: ${error.message}`, 'ERROR');
    return null;
  }
}

// Universal restaurant finder - works for ANY city worldwide
async function findRestaurantsInCity(cityData, cuisineTypes = ['restaurant']) {
  const allRestaurants = [];
  
  for (const type of cuisineTypes) {
    try {
      log(`🔍 Searching for ${type} in ${cityData.name}, ${cityData.country}`);
      
      const url = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json';
      let nextPageToken = null;
      let requestCount = 0;
      
      do {
        const params = {
          location: `${cityData.lat},${cityData.lng}`,
          radius: CONFIG.DEFAULT_RADIUS,
          type: type,
          key: CONFIG.GOOGLE_PLACES_API_KEY
        };
        
        if (nextPageToken) {
          params.pagetoken = nextPageToken;
          // Required delay for next page token
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        const response = await axios.get(url, { params });
        
        if (response.data.status !== 'OK' && response.data.status !== 'ZERO_RESULTS') {
          log(`⚠️  API warning for ${type}: ${response.data.status}`, 'WARN');
          break;
        }
        
        const results = response.data.results || [];
        allRestaurants.push(...results);
        
        nextPageToken = response.data.next_page_token;
        requestCount++;
        
        log(`📍 Found ${results.length} ${type} places (Total: ${allRestaurants.length}, Page: ${requestCount})`);
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY_BETWEEN_REQUESTS));
        
        // Prevent infinite loops and API quota exhaustion
        if (requestCount >= 10 || allRestaurants.length >= CONFIG.MAX_RESULTS_PER_CITY) {
          log(`🛑 Stopping search for ${type} - reached limit`, 'INFO');
          break;
        }
        
      } while (nextPageToken);
      
    } catch (error) {
      log(`❌ Error searching ${type} in ${cityData.name}: ${error.message}`, 'ERROR');
    }
  }
  
  // Remove duplicates by place_id
  const uniqueRestaurants = allRestaurants.reduce((acc, restaurant) => {
    if (!acc.find(r => r.place_id === restaurant.place_id)) {
      acc.push(restaurant);
    }
    return acc;
  }, []);
  
  log(`✅ Total unique restaurants found in ${cityData.name}: ${uniqueRestaurants.length}`);
  return uniqueRestaurants;
}

// CAPTCHA solving utility
async function solveCaptcha(siteKey, pageUrl) {
  if (!CONFIG.TWOCAPTCHA_API_KEY) {
    log('⚠️  No 2captcha API key provided, skipping CAPTCHA', 'WARN');
    return null;
  }

  try {
    log('🧩 Solving CAPTCHA...');
    
    const submitResponse = await axios.post('http://2captcha.com/in.php', {
      key: CONFIG.TWOCAPTCHA_API_KEY,
      method: 'userrecaptcha',
      googlekey: siteKey,
      pageurl: pageUrl
    });

    if (!submitResponse.data.startsWith('OK|')) {
      throw new Error(`CAPTCHA submission failed: ${submitResponse.data}`);
    }

    const captchaId = submitResponse.data.split('|')[1];
    log(`🎯 CAPTCHA submitted with ID: ${captchaId}`);

    // Poll for solution
    for (let i = 0; i < 24; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      
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

// Universal menu scraper - detects platform automatically
async function scrapeRestaurantMenu(restaurant, cityData) {
  const browser = await puppeteer.launch({ 
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=VizDisplayCompositor'
    ]
  });

  try {
    const page = await browser.newPage();
    
    // Set realistic browser fingerprint
    await page.setViewport({ width: 1366, height: 768 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Try multiple search strategies to find menu
    const searchQueries = [
      `${restaurant.name} ${cityData.name} menu`,
      `${restaurant.name} ${cityData.name} delivery`,
      `${restaurant.name} menu online order`,
      `"${restaurant.name}" ${cityData.name} food delivery`
    ];
    
    for (const query of searchQueries) {
      try {
        log(`🔍 Searching: ${query}`);
        
        // Use Google search to find menu pages
        await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`, 
          { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Look for delivery platform links
        const menuLinks = await page.evaluate(() => {
          const links = [];
          const anchors = document.querySelectorAll('a[href*="zomato.com"], a[href*="swiggy.com"], a[href*="ubereats.com"], a[href*="doordash.com"], a[href*="grubhub.com"], a[href*="seamless.com"], a[href*="deliveroo."], a[href*="foodpanda."], a[href*="talabat.com"]');
          
          anchors.forEach(anchor => {
            if (anchor.href && !anchor.href.includes('google.com')) {
              links.push({
                url: anchor.href,
                text: anchor.textContent?.trim(),
                platform: anchor.href.includes('zomato') ? 'zomato' :
                         anchor.href.includes('swiggy') ? 'swiggy' :
                         anchor.href.includes('ubereats') ? 'ubereats' :
                         anchor.href.includes('doordash') ? 'doordash' :
                         anchor.href.includes('deliveroo') ? 'deliveroo' :
                         anchor.href.includes('talabat') ? 'talabat' : 'unknown'
              });
            }
          });
          
          return links.slice(0, 3); // Top 3 results
        });
        
        if (menuLinks.length > 0) {
          // Try to scrape from the first valid menu link
          for (const menuLink of menuLinks) {
            try {
              const menuItems = await scrapeMenuFromPlatform(page, menuLink, restaurant);
              if (menuItems.length > 0) {
                log(`✅ Found ${menuItems.length} menu items from ${menuLink.platform}`);
                return menuItems;
              }
            } catch (error) {
              log(`⚠️  Failed to scrape ${menuLink.platform}: ${error.message}`, 'WARN');
              continue;
            }
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000)); // Delay between searches
        
      } catch (error) {
        log(`❌ Search failed for "${query}": ${error.message}`, 'ERROR');
        continue;
      }
    }
    
    log(`⚠️  No menu found for ${restaurant.name}`, 'WARN');
    return [];
    
  } catch (error) {
    log(`❌ Error scraping menu for ${restaurant.name}: ${error.message}`, 'ERROR');
    return [];
  } finally {
    await browser.close();
  }
}

// Platform-specific menu scraping
async function scrapeMenuFromPlatform(page, menuLink, restaurant) {
  log(`🌐 Accessing ${menuLink.platform}: ${menuLink.url}`);
  
  await page.goto(menuLink.url, { waitUntil: 'networkidle2', timeout: 30000 });
  
  // Check for CAPTCHA
  const captchaElement = await page.$('[data-sitekey], .g-recaptcha, #captcha, .captcha');
  if (captchaElement) {
    log('🚨 CAPTCHA detected, attempting to solve...');
    
    const siteKey = await page.evaluate(() => {
      const element = document.querySelector('[data-sitekey]');
      return element ? element.getAttribute('data-sitekey') : null;
    });
    
    if (siteKey && CONFIG.TWOCAPTCHA_API_KEY) {
      const solution = await solveCaptcha(siteKey, menuLink.url);
      if (solution) {
        await page.evaluate((token) => {
          const responseElement = document.getElementById('g-recaptcha-response');
          if (responseElement) responseElement.innerHTML = token;
          if (typeof grecaptcha !== 'undefined') {
            grecaptcha.getResponse = () => token;
          }
        }, solution);
        
        // Try to submit or continue
        const submitButtons = await page.$$('button[type="submit"], .captcha-submit, input[type="submit"]');
        if (submitButtons.length > 0) {
          await submitButtons[0].click();
          await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
        }
      }
    }
  }
  
  // Universal menu item selectors (works across platforms)
  const menuSelectors = [
    '.menu-item, .dish-item, [data-testid="menu-item"], .food-item',
    '.product-item, .item-card, .dish-card, .menu-card',
    '.restaurant-menu-item, .food-card, .item-container'
  ];
  
  let menuItems = [];
  
  for (const selector of menuSelectors) {
    try {
      await page.waitForSelector(selector, { timeout: 10000 });
      
      menuItems = await page.evaluate((sel) => {
        const items = [];
        const elements = document.querySelectorAll(sel);
        
        elements.forEach(element => {
          // Universal extraction logic
          const nameSelectors = ['.dish-name', '.item-name', '.food-name', '.product-name', 'h3', 'h4', '.title'];
          const priceSelectors = ['.price', '.dish-price', '.item-price', '.cost', '.amount', '[data-testid="price"]'];
          const descSelectors = ['.description', '.dish-description', '.item-desc', '.summary'];
          const imageSelectors = ['img', '.image', '.photo'];
          
          let name = '';
          let price = '';
          let description = '';
          let image = '';
          
          // Extract name
          for (const nameSelector of nameSelectors) {
            const nameEl = element.querySelector(nameSelector);
            if (nameEl && nameEl.textContent?.trim()) {
              name = nameEl.textContent.trim();
              break;
            }
          }
          
          // Extract price
          for (const priceSelector of priceSelectors) {
            const priceEl = element.querySelector(priceSelector);
            if (priceEl && priceEl.textContent?.trim()) {
              price = priceEl.textContent.trim();
              break;
            }
          }
          
          // Extract description
          for (const descSelector of descSelectors) {
            const descEl = element.querySelector(descSelector);
            if (descEl && descEl.textContent?.trim()) {
              description = descEl.textContent.trim();
              break;
            }
          }
          
          // Extract image
          for (const imgSelector of imageSelectors) {
            const imgEl = element.querySelector(imgSelector);
            if (imgEl) {
              image = imgEl.src || imgEl.dataset.src || imgEl.dataset.lazy || '';
              break;
            }
          }
          
          if (name && name.length > 2) { // Basic validation
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
      }, selector);
      
      if (menuItems.length > 0) {
        log(`📋 Extracted ${menuItems.length} items using selector: ${selector}`);
        break;
      }
    } catch (error) {
      // Try next selector
      continue;
    }
  }
  
  return menuItems;
}

// CLI interface with unlimited city support
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (!command) {
    console.log(`
🤖 NutriAI Universal Scraper - No Limits!

Usage:
  node universal-scraper.js restaurants --city "CityName" [--country "Country"]
  node universal-scraper.js restaurants --all-major  # Scrape popular cities
  node universal-scraper.js menus                    # Scrape menus for existing restaurants

Examples:
  node universal-scraper.js restaurants --city "Tokyo" --country "Japan"
  node universal-scraper.js restaurants --city "Lagos" --country "Nigeria"  
  node universal-scraper.js restaurants --city "São Paulo" --country "Brazil"
  node universal-scraper.js restaurants --city "any-city-worldwide"

Requirements:
  GOOGLE_PLACES_API_KEY=your_key_here (in .env file)
  TWOCAPTCHA_API_KEY=your_key_here (optional, for CAPTCHA solving)
  
🌍 Works for ANY city worldwide - no limitations!
    `);
    return;
  }
  
  await connectDatabase();
  
  if (command === 'restaurants') {
    const cityFlag = args.indexOf('--city');
    const countryFlag = args.indexOf('--country');
    const allMajorFlag = args.indexOf('--all-major');
    
    if (allMajorFlag !== -1) {
      // Scrape major cities worldwide
      const majorCities = [
        { name: 'Mumbai', country: 'India' },
        { name: 'Delhi', country: 'India' },
        { name: 'Dubai', country: 'UAE' },
        { name: 'London', country: 'UK' },
        { name: 'New York', country: 'USA' },
        { name: 'Tokyo', country: 'Japan' },
        { name: 'Singapore', country: 'Singapore' },
        { name: 'Bangkok', country: 'Thailand' }
        // Add any cities you want
      ];
      
      for (const cityInfo of majorCities) {
        const cityData = await getCityCoordinates(cityInfo.name, cityInfo.country);
        if (cityData) {
          const restaurants = await findRestaurantsInCity(cityData, CONFIG.CUISINE_TYPES);
          log(`✅ Completed ${cityInfo.name}: ${restaurants.length} restaurants`);
        }
      }
    } else if (cityFlag !== -1 && args[cityFlag + 1]) {
      const cityName = args[cityFlag + 1];
      const countryName = countryFlag !== -1 && args[countryFlag + 1] ? args[countryFlag + 1] : '';
      
      log(`🌍 Starting restaurant discovery for ${cityName}${countryName ? ', ' + countryName : ''}`);
      
      const cityData = await getCityCoordinates(cityName, countryName);
      if (!cityData) {
        log(`❌ Could not find coordinates for ${cityName}`, 'ERROR');
        return;
      }
      
      log(`📍 Found: ${cityData.formatted_address}`);
      
      const restaurants = await findRestaurantsInCity(cityData, CONFIG.CUISINE_TYPES);
      log(`🎉 Discovery completed! Found ${restaurants.length} restaurants in ${cityName}`);
    } else {
      log('❌ Please specify --city "CityName" or use --all-major', 'ERROR');
    }
  } else if (command === 'menus') {
    log('🍽️  Starting menu scraping for existing restaurants...');
    
    const [restaurants] = await db.execute(`
      SELECT * FROM restaurants 
      WHERE last_scraped IS NULL 
      LIMIT 10
    `);
    
    for (const restaurant of restaurants) {
      const cityData = {
        name: restaurant.city,
        country: restaurant.country,
        lat: restaurant.latitude,
        lng: restaurant.longitude
      };
      
      const menuItems = await scrapeRestaurantMenu(restaurant, cityData);
      log(`📋 ${restaurant.name}: Found ${menuItems.length} menu items`);
    }
  }
  
  if (db) {
    await db.end();
    log('📔 Database connection closed');
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { 
  getCityCoordinates, 
  findRestaurantsInCity, 
  scrapeRestaurantMenu 
};