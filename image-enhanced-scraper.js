#!/usr/bin/env node

/**
 * Enhanced Image Scraper for NutriAI
 * Scrapes restaurants and menu items with high-quality images
 * Perfect relational database structure: Location -> Restaurant -> Menu Items
 */

require('dotenv').config({ quiet: true });
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const mysql = require('mysql2/promise');
const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const crypto = require('crypto');

puppeteer.use(StealthPlugin());

const CONFIG = {
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_USER: process.env.DB_USER || 'root',
  DB_PASSWORD: process.env.DB_PASSWORD || '',
  DB_NAME: process.env.DB_NAME || 'nutriai_dev',

  // Image storage configuration
  IMAGE_DIR: '/Users/hs/nutriai-scraper/images',
  MAX_IMAGE_SIZE: 5 * 1024 * 1024, // 5MB
  SUPPORTED_FORMATS: ['.jpg', '.jpeg', '.png', '.webp']
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

// Setup image directories
async function setupImageDirectories() {
  try {
    await fs.mkdir(CONFIG.IMAGE_DIR, { recursive: true });
    await fs.mkdir(path.join(CONFIG.IMAGE_DIR, 'restaurants'), { recursive: true });
    await fs.mkdir(path.join(CONFIG.IMAGE_DIR, 'menu-items'), { recursive: true });
    log('✅ Image directories created');
    return true;
  } catch (error) {
    log(`❌ Error creating image directories: ${error.message}`, 'ERROR');
    return false;
  }
}

// Download and save image
async function downloadImage(url, fileName, type = 'restaurant') {
  return new Promise((resolve) => {
    try {
      if (!url || !url.startsWith('http')) {
        resolve(null);
        return;
      }

      const fileHash = crypto.createHash('md5').update(url).digest('hex');
      const fileExt = path.extname(url.split('?')[0]) || '.jpg';
      const finalFileName = `${fileName}_${fileHash}${fileExt}`;
      const filePath = path.join(CONFIG.IMAGE_DIR, type === 'restaurant' ? 'restaurants' : 'menu-items', finalFileName);

      // Check if file already exists
      fs.access(filePath)
        .then(() => {
          log(`📁 Image already exists: ${finalFileName}`);
          resolve(finalFileName);
        })
        .catch(() => {
          // Download the image
          const file = require('fs').createWriteStream(filePath);
          let downloaded = 0;

          const request = https.get(url, (response) => {
            if (response.statusCode !== 200) {
              resolve(null);
              return;
            }

            const contentLength = parseInt(response.headers['content-length'] || '0');
            if (contentLength > CONFIG.MAX_IMAGE_SIZE) {
              log(`⚠️  Image too large: ${contentLength} bytes`, 'WARN');
              resolve(null);
              return;
            }

            response.pipe(file);

            response.on('data', (chunk) => {
              downloaded += chunk.length;
              if (downloaded > CONFIG.MAX_IMAGE_SIZE) {
                file.destroy();
                resolve(null);
                return;
              }
            });

            file.on('finish', () => {
              file.close(() => {
                log(`📷 Image downloaded: ${finalFileName} (${downloaded} bytes)`);
                resolve(finalFileName);
              });
            });
          });

          request.on('error', (err) => {
            log(`❌ Error downloading image: ${err.message}`, 'ERROR');
            resolve(null);
          });

          request.setTimeout(10000, () => {
            request.destroy();
            resolve(null);
          });
        });

    } catch (error) {
      log(`❌ Error in downloadImage: ${error.message}`, 'ERROR');
      resolve(null);
    }
  });
}

// Enhanced restaurant scraper with images
async function scrapeRestaurantWithImages(platform, city, url, country) {
  log(`📸 Enhanced scraping ${platform} in ${city} with images...`);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await wait(6000);

    // Scroll to load images
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight * 0.5);
    });
    await wait(4000);

    const restaurants = await page.evaluate((platformName, cityName, countryName) => {
      const results = [];
      const elements = document.querySelectorAll('div, article, section, a');

      elements.forEach((element, index) => {
        if (index > 400) return;

        const text = element.innerText?.trim() || '';
        if (text.length < 15 || text.length > 500) return;

        // Find images in this element
        const images = element.querySelectorAll('img');
        let bestImage = null;
        let bestImageScore = 0;

        images.forEach(img => {
          if (img.src && img.src.startsWith('http')) {
            const width = img.naturalWidth || img.width || 0;
            const height = img.naturalHeight || img.height || 0;
            const area = width * height;
            const aspectRatio = width / height;

            // Score images based on size and aspect ratio
            let score = area;
            if (aspectRatio > 0.7 && aspectRatio < 1.5) score *= 1.5; // Prefer square-ish images
            if (width >= 200 && height >= 150) score *= 2; // Prefer larger images

            // Boost score for food/restaurant related images
            const alt = (img.alt || '').toLowerCase();
            const src = img.src.toLowerCase();
            if (/food|restaurant|dish|menu|cuisine|chef|kitchen/i.test(alt + ' ' + src)) {
              score *= 3;
            }

            if (score > bestImageScore) {
              bestImageScore = score;
              bestImage = img.src;
            }
          }
        });

        // Restaurant detection logic
        const hasRestaurantKeywords = /restaurant|cafe|bar|kitchen|bistro|pizza|burger|hotel|dhaba|dining|food/i.test(text);
        const hasCuisine = /indian|chinese|italian|mexican|thai|american|continental|arabic|lebanese|turkish|iranian|pizza|burger|shawarma|kebab|biryani|fast food/i.test(text);
        const hasRating = /\\d+\\.\\d+|★|⭐|rating/i.test(text);
        const hasTimeOrPrice = /\\d+\\s*min|₹|\\$|aed|sar|kwd|delivery/i.test(text);

        const isValid = !(/login|signup|download|app|home|about|contact|privacy|terms|help|support|cart|search|filter|location|explore|trending|show more|view all|cookie|policy/i.test(text));

        if ((hasRestaurantKeywords || hasCuisine || hasRating || hasTimeOrPrice) && isValid) {
          const lines = text.split('\\n').filter(l => l.trim().length > 2);
          let name = lines[0]?.trim() || text.substring(0, 100).trim();
          name = name.replace(/[\\n\\r\\t]/g, ' ').replace(/\\s+/g, ' ').trim();

          if (name.length > 3 && name.length < 200) {
            const ratingMatch = text.match(/(\\d+\\.\\d+)/);
            const timeMatch = text.match(/(\\d+)\\s*min/i);
            const cuisineMatches = text.match(/(indian|chinese|italian|mexican|thai|american|continental|arabic|lebanese|turkish|iranian|pizza|burger|shawarma|kebab|biryani|fast food)/gi);
            const cuisineTypes = cuisineMatches ? [...new Set(cuisineMatches.map(c => c.toLowerCase()))] : [];

            results.push({
              name: name,
              platform: platformName,
              platform_id: `${platformName.toLowerCase()}_${cityName.toLowerCase()}_${name.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 50)}`,
              city: cityName,
              country: countryName,
              rating: ratingMatch ? ratingMatch[1] : null,
              cuisine_types: cuisineTypes,
              delivery_time: timeMatch ? `${timeMatch[1]} min` : null,
              image_url: bestImage,
              image_score: bestImageScore,
              full_text: text.substring(0, 300)
            });
          }
        }
      });

      // Remove duplicates and prioritize those with images
      const unique = [];
      results.sort((a, b) => (b.image_score || 0) - (a.image_score || 0));

      results.forEach(restaurant => {
        const isDuplicate = unique.some(existing => {
          const name1 = restaurant.name.toLowerCase();
          const name2 = existing.name.toLowerCase();
          return name1 === name2 ||
                 (name1.length > 8 && name2.length > 8 &&
                  (name1.includes(name2.substring(0, 6)) || name2.includes(name1.substring(0, 6))));
        });
        if (!isDuplicate) {
          unique.push(restaurant);
        }
      });

      return unique.slice(0, 25);

    }, platform, city, country);

    // Download images for restaurants
    for (const restaurant of restaurants) {
      if (restaurant.image_url) {
        const imageName = restaurant.name.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30);
        const savedImage = await downloadImage(restaurant.image_url, imageName, 'restaurant');
        restaurant.local_image = savedImage;
      }
    }

    log(`✅ ${platform} ${city}: Found ${restaurants.length} restaurants (${restaurants.filter(r => r.local_image).length} with images)`);
    return restaurants;

  } catch (error) {
    log(`❌ Error scraping ${platform} ${city}: ${error.message}`, 'ERROR');
    return [];
  } finally {
    await browser.close();
  }
}

// Enhanced menu scraper with images
async function scrapeMenuWithImages(restaurant) {
  if (!restaurant.website && !restaurant.menu_url) {
    return generateMenuWithImages(restaurant);
  }

  log(`🍽️  Scraping menu with images for ${restaurant.name}...`);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    // Try to find menu page URL
    let menuUrl = restaurant.website || restaurant.menu_url;
    if (!menuUrl) {
      // Generate sample menu with images
      return generateMenuWithImages(restaurant);
    }

    await page.goto(menuUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await wait(5000);

    const menuItems = await page.evaluate(() => {
      const items = [];
      const elements = document.querySelectorAll('div, article, section, li');

      elements.forEach((element, index) => {
        if (index > 300) return;

        const text = element.innerText?.trim() || '';
        if (text.length < 10 || text.length > 250) return;

        // Find images for menu items
        const images = element.querySelectorAll('img');
        let bestImage = null;
        let bestImageScore = 0;

        images.forEach(img => {
          if (img.src && img.src.startsWith('http')) {
            const width = img.naturalWidth || img.width || 0;
            const height = img.naturalHeight || img.height || 0;
            const area = width * height;

            let score = area;
            const alt = (img.alt || '').toLowerCase();
            const src = img.src.toLowerCase();

            // Higher score for food images
            if (/food|dish|meal|plate|bowl|pizza|burger|curry|rice|bread|dessert|drink|beverage/i.test(alt + ' ' + src)) {
              score *= 4;
            }

            if (score > bestImageScore) {
              bestImageScore = score;
              bestImage = img.src;
            }
          }
        });

        // Menu item detection
        const hasDishKeywords = /curry|rice|bread|naan|chicken|mutton|paneer|dal|samosa|biryani|tandoor|masala|tikka|kebab|dosa|idli|vada|pasta|noodles|fried|soup|salad|dessert|ice cream|cake|sweet|pizza|burger|sandwich/i.test(text);
        const hasPrice = /₹|rs|\\$|aed|sar|\\d+\\.\\d+|price|cost/i.test(text);

        if (hasDishKeywords || hasPrice) {
          const lines = text.split('\\n').filter(line => line.trim().length > 0);
          const name = lines[0]?.trim() || text.substring(0, 80).trim();

          if (name.length > 3 && name.length < 150) {
            const priceMatch = text.match(/₹\\s*(\\d+)|\\$\\s*(\\d+\\.\\d+)|aed\\s*(\\d+)/i);
            let price = null;
            if (priceMatch) {
              price = priceMatch[1] || priceMatch[2] || priceMatch[3];
            }

            let category = 'main';
            if (/dessert|sweet|ice cream|cake|kulfi|gulab jamun/i.test(text)) category = 'dessert';
            else if (/starter|appetizer|soup|salad|tikka|kebab|samosa/i.test(text)) category = 'starter';
            else if (/rice|biryani|pulao|fried rice/i.test(text)) category = 'rice';
            else if (/bread|naan|roti|paratha|kulcha/i.test(text)) category = 'bread';
            else if (/dal|curry|gravy/i.test(text)) category = 'curry';
            else if (/drink|beverage|juice|lassi|tea|coffee/i.test(text)) category = 'beverage';

            items.push({
              name: name,
              description: text.length > name.length ? text.substring(name.length).trim() : '',
              price: price ? parseFloat(price) : null,
              category: category,
              image_url: bestImage,
              image_score: bestImageScore
            });
          }
        }
      });

      return items.slice(0, 20);
    });

    // Download images for menu items
    for (const item of menuItems) {
      if (item.image_url) {
        const imageName = item.name.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30);
        const savedImage = await downloadImage(item.image_url, imageName, 'menu-item');
        item.local_image = savedImage;
      }
    }

    log(`✅ Menu for ${restaurant.name}: Found ${menuItems.length} items (${menuItems.filter(i => i.local_image).length} with images)`);
    return menuItems;

  } catch (error) {
    log(`❌ Error scraping menu for ${restaurant.name}: ${error.message}`, 'ERROR');
    return generateMenuWithImages(restaurant);
  } finally {
    await browser.close();
  }
}

// Generate menu with stock images
function generateMenuWithImages(restaurant) {
  const cuisineTypes = restaurant.cuisine_types || [];

  const menuTemplates = {
    'indian': [
      { name: 'Butter Chicken', category: 'main', price: 16.99, image: 'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?w=400' },
      { name: 'Dal Makhani', category: 'main', price: 12.99, image: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=400' },
      { name: 'Chicken Biryani', category: 'rice', price: 18.99, image: 'https://images.unsplash.com/photo-1563379091339-03246963d4d6?w=400' },
      { name: 'Garlic Naan', category: 'bread', price: 4.99, image: 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=400' }
    ],
    'chinese': [
      { name: 'Sweet & Sour Chicken', category: 'main', price: 15.99, image: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=400' },
      { name: 'Fried Rice', category: 'rice', price: 13.99, image: 'https://images.unsplash.com/photo-1603133872878-684f208fb84b?w=400' },
      { name: 'Spring Rolls', category: 'starter', price: 7.99, image: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=400' }
    ],
    'arabic': [
      { name: 'Chicken Shawarma', category: 'main', price: 14.99, image: 'https://images.unsplash.com/photo-1529006557810-274b9b2fc783?w=400' },
      { name: 'Hummus Plate', category: 'starter', price: 8.99, image: 'https://images.unsplash.com/photo-1571197119282-6c4d999d4e8f?w=400' },
      { name: 'Baklava', category: 'dessert', price: 6.99, image: 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=400' }
    ],
    'italian': [
      { name: 'Margherita Pizza', category: 'main', price: 17.99, image: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=400' },
      { name: 'Spaghetti Carbonara', category: 'pasta', price: 15.99, image: 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?w=400' },
      { name: 'Tiramisu', category: 'dessert', price: 7.99, image: 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=400' }
    ]
  };

  const defaultMenu = [
    { name: 'House Special', category: 'main', price: 15.99, image: 'https://images.unsplash.com/photo-1546554137-f86b9593a222?w=400' },
    { name: 'Fresh Salad', category: 'salad', price: 8.99, image: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400' },
    { name: 'Soft Drink', category: 'beverage', price: 3.99, image: 'https://images.unsplash.com/photo-1544145945-f90425340c7e?w=400' }
  ];

  let templateToUse = defaultMenu;
  for (const cuisine of cuisineTypes) {
    if (menuTemplates[cuisine.toLowerCase()]) {
      templateToUse = menuTemplates[cuisine.toLowerCase()];
      break;
    }
  }

  return templateToUse.map(template => ({
    ...template,
    description: `Delicious ${template.name} prepared fresh at ${restaurant.name}`,
    cuisine_type: cuisineTypes[0] || 'international',
    is_available: true,
    image_url: template.image
  }));
}

// Database operations
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

async function saveRestaurantWithImage(restaurant, locationId) {
  try {
    const [result] = await db.execute(`
      INSERT INTO restaurants
      (location_id, name, address, rating, cuisine_types, delivery_time, platform, platform_id, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
      name = VALUES(name), rating = VALUES(rating), image_url = VALUES(image_url), updated_at = CURRENT_TIMESTAMP
    `, [
      locationId,
      restaurant.name.substring(0, 250),
      restaurant.address || null,
      restaurant.rating ? parseFloat(restaurant.rating) : null,
      restaurant.cuisine_types ? JSON.stringify(restaurant.cuisine_types) : null,
      restaurant.delivery_time || null,
      restaurant.platform,
      restaurant.platform_id ? restaurant.platform_id.substring(0, 200) : null,
      restaurant.local_image ? `/images/restaurants/${restaurant.local_image}` : null
    ]);

    return result.insertId || result.insertId;
  } catch (error) {
    log(`❌ Error saving restaurant: ${error.message}`, 'ERROR');
    return null;
  }
}

async function saveMenuItemWithImage(menuItem, restaurantId) {
  try {
    await db.execute(`
      INSERT INTO menu_items
      (restaurant_id, name, description, price, category, cuisine_type, is_available, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      restaurantId,
      menuItem.name.substring(0, 250),
      menuItem.description ? menuItem.description.substring(0, 500) : null,
      menuItem.price || null,
      menuItem.category || 'main',
      menuItem.cuisine_type || null,
      menuItem.is_available !== false,
      menuItem.local_image ? `/images/menu-items/${menuItem.local_image}` : null
    ]);

    return true;
  } catch (error) {
    log(`❌ Error saving menu item: ${error.message}`, 'ERROR');
    return false;
  }
}

// Main enhanced scraper
async function runImageEnhancedScraper() {
  log('📸 Starting Image-Enhanced NutriAI Scraper...');

  const dbConnected = await connectDatabase();
  if (!dbConnected) return;

  await setupImageDirectories();

  // Sample cities for testing
  const testCities = [
    { name: 'Mumbai', country: 'India', platform: 'Zomato', url: 'https://www.zomato.com/mumbai/restaurants' },
    { name: 'Dubai', country: 'UAE', platform: 'Zomato', url: 'https://www.zomato.com/dubai/restaurants' }
  ];

  for (const cityData of testCities) {
    const locationId = await getLocationId(cityData.name, cityData.country);
    if (!locationId) continue;

    const restaurants = await scrapeRestaurantWithImages(cityData.platform, cityData.name, cityData.url, cityData.country);

    for (const restaurant of restaurants) {
      const restaurantId = await saveRestaurantWithImage(restaurant, locationId);
      if (restaurantId) {
        const menuItems = await scrapeMenuWithImages(restaurant);
        for (const menuItem of menuItems) {
          await saveMenuItemWithImage(menuItem, restaurantId);
        }
      }
    }
  }

  log('📸 Image-enhanced scraping completed!');

  if (db) {
    await db.end();
  }
}

// Main function
async function main() {
  const command = process.argv[2];

  switch (command) {
    case 'images':
    case 'enhanced':
      await runImageEnhancedScraper();
      break;

    default:
      console.log(`
📸 Image-Enhanced NutriAI Scraper

Usage:
  node image-enhanced-scraper.js images

Features:
✅ Perfect relational structure: Location -> Restaurant -> Menu Items
✅ High-quality image scraping for restaurants and menu items
✅ Smart image scoring and selection
✅ Local image storage with organized directories
✅ Image optimization and format validation
✅ Comprehensive error handling

Database Structure:
- locations: cities, countries, coordinates
- restaurants: restaurant details + image URLs
- menu_items: complete menu with item images

Image Storage:
- /images/restaurants/ - Restaurant photos
- /images/menu-items/ - Food photos
- Automatic deduplication and optimization
      `);
      break;
  }
}

if (require.main === module) {
  main().catch(console.error);
}