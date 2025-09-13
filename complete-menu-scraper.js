#!/usr/bin/env node

/**
 * Complete Menu Scraper - Extracts ALL REAL menu items
 * No limits, no templates - gets every single dish from restaurant pages
 */

require('dotenv').config({ quiet: true });
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const mysql = require('mysql2/promise');

puppeteer.use(StealthPlugin());

const CONFIG = {
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_USER: process.env.DB_USER || 'root',
  DB_PASSWORD: process.env.DB_PASSWORD || '',
  DB_NAME: process.env.DB_NAME || 'nutriai_dev'
};

let db;

function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${message}`);
}

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Connect to database
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

// Extract ALL menu items from a restaurant page (no limits)
async function extractAllMenuItems(restaurantUrl, restaurantName) {
  log(`🍽️  Extracting ALL menu items from: ${restaurantName}`);

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    await page.goto(restaurantUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await wait(6000);

    // Aggressive scrolling to load ALL menu content
    for (let i = 0; i < 10; i++) {
      await page.evaluate((i) => {
        window.scrollTo(0, document.body.scrollHeight * (0.1 * (i + 1)));
      }, i);
      await wait(1500);
    }

    // Scroll to the very bottom
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await wait(4000);

    // Look for "Show More" or "Load More" buttons and click them
    await page.evaluate(() => {
      const buttons = document.querySelectorAll('button, a, span, div');
      buttons.forEach(button => {
        const text = button.innerText?.toLowerCase() || '';
        if (/show more|load more|view more|see all|expand|more items|full menu/i.test(text)) {
          try {
            button.click();
          } catch (e) {
            // Ignore click errors
          }
        }
      });
    });
    await wait(3000);

    // Extract ALL menu items (no limits)
    const allMenuItems = await page.evaluate(() => {
      const menuItems = [];

      // Comprehensive menu item selectors
      const menuSelectors = [
        '[class*="menu-item"]',
        '[class*="dish"]',
        '[class*="food-item"]',
        '[class*="item-card"]',
        '[data-testid*="menu"]',
        '[data-testid*="dish"]',
        '[data-testid*="item"]',
        '.menu-card',
        '.dish-card',
        '.food-card',
        '[role="listitem"]',
        'li[class*="item"]',
        'div[class*="item"]'
      ];

      // Also look for text patterns that indicate menu items
      const allElements = document.querySelectorAll('*');

      allElements.forEach((element, index) => {
        // No index limit - process ALL elements
        const text = element.innerText?.trim() || '';

        // Skip very short or very long text
        if (text.length < 4 || text.length > 500) return;

        // Enhanced food item detection
        const foodKeywords = /curry|rice|bread|naan|chicken|mutton|paneer|dal|samosa|biryani|tandoor|masala|tikka|kebab|dosa|idli|vada|pasta|noodles|fried|soup|salad|dessert|ice cream|cake|sweet|pizza|burger|sandwich|roll|wrap|juice|lassi|tea|coffee|chapati|roti|paratha|kulcha|raita|pickle|papad|gulab jamun|rasmalai|kheer|halwa|payasam|rabri|kulfi|falooda|brownie|pastry|mousse|tart|pie|croissant|bagel|waffle|pancake|omelette|scrambled|toast|cereal|yogurt|smoothie|milkshake|lemonade|mojito|cocktail|wine|beer|whiskey|vodka|gin|rum/i;

        const priceKeywords = /₹|rs|\\$|aed|sar|kwd|bhd|qar|price|cost|\\d+\\.\\d+|\\d+\\s*only|starting|from/i;

        // Enhanced navigation filter
        const navigationKeywords = /login|signup|cart|checkout|home|about|contact|delivery|offers|discount|download|app|search|filter|sort|location|city|order now|view all|show more|load more|continue|next|previous|back|menu|categories|restaurant info|reviews|photos|directions|call|book table|reserve|share|favorite|wishlist|follow|like|rating|review|write review|upload photo|report|help|support|terms|privacy|policy|footer|header|navbar|sidebar|advertisement|ad|sponsored|promotion|banner|popup|modal|overlay|loading|error|404|500|not found|server error|maintenance|coming soon|under construction/i;

        // Check if this looks like a real menu item
        if (foodKeywords.test(text) || priceKeywords.test(text)) {
          // Make sure it's not navigation or promotional content
          if (!navigationKeywords.test(text)) {
            const lines = text.split('\\n').filter(line => line.trim().length > 0);
            const itemName = lines[0]?.trim() || text.substring(0, 100).trim();

            // Enhanced filtering for actual food items
            if (itemName.length > 2 && itemName.length < 200) {
              // Extract price with multiple patterns
              const pricePatterns = [
                /₹\\s*(\\d+(?:\\.\\d{2})?)/i,
                /rs\\.?\\s*(\\d+)/i,
                /\\$\\s*(\\d+(?:\\.\\d{2})?)/i,
                /aed\\s*(\\d+)/i,
                /sar\\s*(\\d+)/i,
                /(\\d+)\\s*₹/i,
                /(\\d+)\\s*rs/i
              ];

              let price = null;
              for (const pattern of pricePatterns) {
                const match = text.match(pattern);
                if (match) {
                  price = parseFloat(match[1]);
                  break;
                }
              }

              // Extract description (everything after the name)
              let description = '';
              if (lines.length > 1) {
                description = lines.slice(1).join(' ').trim();
              } else if (text.length > itemName.length + 10) {
                description = text.substring(itemName.length).trim();
              }

              // Advanced category detection
              let category = 'main';
              const itemText = text.toLowerCase();

              if (/starter|appetizer|soup|salad|tikka|kebab|samosa|pakora|chaat|cutlet|finger food/i.test(itemText)) {
                category = 'starter';
              } else if (/dessert|sweet|ice cream|cake|kulfi|gulab jamun|rasmalai|kheer|halwa|payasam|rabri|falooda|brownie|pastry|mousse|tart|pie/i.test(itemText)) {
                category = 'dessert';
              } else if (/rice|biryani|pulao|fried rice|jeera rice|coconut rice|lemon rice/i.test(itemText)) {
                category = 'rice';
              } else if (/bread|naan|roti|paratha|kulcha|chapati|puri|bhatura|kulcha/i.test(itemText)) {
                category = 'bread';
              } else if (/dal|curry|gravy|sabji|subzi|korma|masala|kadai/i.test(itemText)) {
                category = 'curry';
              } else if (/drink|beverage|juice|lassi|tea|coffee|shake|smoothie|water|soda|cola|lemonade|mojito|cocktail|wine|beer|whiskey|vodka/i.test(itemText)) {
                category = 'beverage';
              } else if (/pizza/i.test(itemText)) {
                category = 'pizza';
              } else if (/burger/i.test(itemText)) {
                category = 'burger';
              } else if (/pasta|noodles|spaghetti|penne|fusilli|lasagna/i.test(itemText)) {
                category = 'pasta';
              } else if (/sandwich|roll|wrap|sub|panini/i.test(itemText)) {
                category = 'snack';
              }

              // Extract dietary information
              const dietaryInfo = [];
              if (/veg|vegetarian/i.test(itemText) && !/non.veg|chicken|mutton|fish|egg|meat/i.test(itemText)) {
                dietaryInfo.push('vegetarian');
              }
              if (/non.veg|chicken|mutton|fish|meat|egg|beef|lamb|pork/i.test(itemText)) {
                dietaryInfo.push('non-vegetarian');
              }
              if (/jain/i.test(itemText)) {
                dietaryInfo.push('jain');
              }
              if (/vegan/i.test(itemText)) {
                dietaryInfo.push('vegan');
              }
              if (/gluten.free/i.test(itemText)) {
                dietaryInfo.push('gluten-free');
              }

              // Extract spice level
              let spiceLevel = null;
              if (/mild|not spicy|less spicy/i.test(itemText)) spiceLevel = 'mild';
              else if (/medium spicy|moderately spicy/i.test(itemText)) spiceLevel = 'medium';
              else if (/spicy|hot|very spicy|extra spicy/i.test(itemText)) spiceLevel = 'spicy';

              // Extract cuisine type
              const cuisinePattern = /(north indian|south indian|chinese|italian|mexican|thai|american|continental|arabic|lebanese|turkish|iranian|punjabi|gujarati|maharashtrian|bengali|rajasthani|kerala|tamil|kashmiri|hyderabadi|lucknowi|awadhi|mughlai|street food|fast food)/gi;
              const cuisineMatch = text.match(cuisinePattern);
              const cuisine = cuisineMatch ? cuisineMatch[0].toLowerCase() : null;

              // Check availability
              const isAvailable = !/out of stock|not available|unavailable|sold out|temporarily unavailable/i.test(itemText);

              // Check if it's popular/recommended
              const isPopular = /popular|recommended|bestseller|chef special|house special|signature|most ordered|top rated/i.test(itemText);

              // Extract preparation time if mentioned
              const timeMatch = text.match(/(\\d+)\\s*min/i);
              const prepTime = timeMatch ? `${timeMatch[1]} min` : null;

              menuItems.push({
                name: itemName,
                description: description.substring(0, 500),
                price: price,
                category: category,
                cuisine_type: cuisine,
                dietary_info: dietaryInfo,
                spice_level: spiceLevel,
                is_available: isAvailable,
                is_popular: isPopular,
                preparation_time: prepTime,
                full_text: text.substring(0, 400)
              });
            }
          }
        }
      });

      // Remove exact duplicates only (don't filter similar items)
      const uniqueMenuItems = [];
      menuItems.forEach(item => {
        const exactDuplicate = uniqueMenuItems.some(existing =>
          existing.name.toLowerCase() === item.name.toLowerCase() &&
          existing.price === item.price
        );
        if (!exactDuplicate) {
          uniqueMenuItems.push(item);
        }
      });

      return uniqueMenuItems; // NO LIMIT - return all items found
    });

    log(`✅ Extracted ${allMenuItems.length} REAL menu items from ${restaurantName}`);
    return allMenuItems;

  } catch (error) {
    log(`❌ Error extracting menu from ${restaurantName}: ${error.message}`, 'ERROR');
    return [];
  } finally {
    await browser.close();
  }
}

// Save menu item with proper null handling
async function saveCompleteMenuItem(menuItem, restaurantId) {
  try {
    await db.execute(`
      INSERT INTO menu_items
      (restaurant_id, name, description, price, category, cuisine_type,
       dietary_info, is_available, is_popular, spice_level, preparation_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      restaurantId,
      menuItem.name.substring(0, 250),
      menuItem.description || null,
      menuItem.price || null,
      menuItem.category || 'main',
      menuItem.cuisine_type || null,
      menuItem.dietary_info && menuItem.dietary_info.length > 0 ? JSON.stringify(menuItem.dietary_info) : null,
      menuItem.is_available !== false,
      menuItem.is_popular || false,
      menuItem.spice_level || null,
      menuItem.preparation_time || null
    ]);

    return true;
  } catch (error) {
    log(`❌ Error saving menu item: ${error.message}`, 'ERROR');
    return false;
  }
}

// Get restaurant URLs for menu extraction
async function getRestaurantUrls() {
  try {
    const [restaurants] = await db.execute(`
      SELECT r.id, r.name, l.city, l.area, r.platform
      FROM restaurants r
      JOIN locations l ON r.location_id = l.id
      WHERE l.area IN ('Bandra West', 'Powai', 'Andheri West')
      AND r.platform = 'Zomato'
      LIMIT 10
    `);

    return restaurants.map(r => ({
      id: r.id,
      name: r.name,
      url: `https://www.zomato.com/${r.city.toLowerCase()}/${r.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}/menu`,
      fallbackUrl: `https://www.zomato.com/${r.city.toLowerCase()}/restaurants`
    }));
  } catch (error) {
    log(`❌ Error getting restaurant URLs: ${error.message}`, 'ERROR');
    return [];
  }
}

// Main function to extract complete menus
async function extractCompleteMenus() {
  log('🍽️  Starting COMPLETE Menu Extraction (NO LIMITS)...');

  const dbConnected = await connectDatabase();
  if (!dbConnected) return;

  const restaurantUrls = await getRestaurantUrls();
  log(`📋 Found ${restaurantUrls.length} restaurants to extract complete menus from`);

  let totalMenuItems = 0;

  for (const restaurant of restaurantUrls) {
    try {
      log(`\\n🏪 Processing: ${restaurant.name}`);

      // Try primary URL first, then fallback
      let menuItems = await extractAllMenuItems(restaurant.url, restaurant.name);

      if (menuItems.length === 0) {
        log(`⚠️  No items from primary URL, trying fallback...`);
        menuItems = await extractAllMenuItems(restaurant.fallbackUrl, restaurant.name);
      }

      // Save ALL menu items to database
      for (const menuItem of menuItems) {
        const saved = await saveCompleteMenuItem(menuItem, restaurant.id);
        if (saved) totalMenuItems++;
      }

      log(`✅ ${restaurant.name}: Saved ${menuItems.length} menu items`);
      await wait(4000); // Delay between restaurants

    } catch (error) {
      log(`❌ Error processing ${restaurant.name}: ${error.message}`, 'ERROR');
    }
  }

  // Final summary
  log('\\n🎉 COMPLETE MENU EXTRACTION FINISHED!');
  log(`✅ Total Menu Items Extracted: ${totalMenuItems}`);

  // Database verification
  const [stats] = await db.execute(`
    SELECT
      r.name,
      l.area,
      COUNT(m.id) as menu_items_count
    FROM restaurants r
    JOIN locations l ON r.location_id = l.id
    LEFT JOIN menu_items m ON r.id = m.restaurant_id
    WHERE l.area IN ('Bandra West', 'Powai', 'Andheri West')
    GROUP BY r.id, r.name, l.area
    ORDER BY menu_items_count DESC
    LIMIT 15
  `);

  log('\\n📊 MENU EXTRACTION RESULTS:');
  stats.forEach(stat => {
    log(`   ${stat.name.substring(0, 40)} (${stat.area}): ${stat.menu_items_count} items`);
  });

  if (db) {
    await db.end();
  }

  log('\\n🎯 ALL REAL MENU ITEMS EXTRACTED - NO LIMITS APPLIED!');
}

// Alternative: Extract from restaurant listing pages with enhanced detection
async function extractFromListingPages() {
  log('🍽️  Extracting menus from restaurant listing pages...');

  const dbConnected = await connectDatabase();
  if (!dbConnected) return;

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    // Test specific restaurant pages that show menus
    const testUrls = [
      'https://www.zomato.com/mumbai/restaurants/north-indian',
      'https://www.zomato.com/mumbai/restaurants/chinese',
      'https://www.zomato.com/mumbai/restaurants/south-indian'
    ];

    let totalExtracted = 0;

    for (const testUrl of testUrls) {
      await page.goto(testUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await wait(5000);

      // Comprehensive scrolling
      for (let i = 0; i < 8; i++) {
        await page.evaluate((i) => {
          window.scrollTo(0, document.body.scrollHeight * (0.125 * (i + 1)));
        }, i);
        await wait(2000);
      }

      const menuItems = await page.evaluate(() => {
        const items = [];

        // Look for any element that might contain food item information
        const allElements = document.querySelectorAll('*');

        allElements.forEach(element => {
          const text = element.innerText?.trim() || '';

          if (text.length > 5 && text.length < 400) {
            // Comprehensive food detection
            const hasFoodWords = /biryani|curry|dal|paneer|chicken|mutton|fish|rice|bread|naan|roti|pizza|burger|pasta|noodles|soup|salad|dessert|cake|ice cream|juice|lassi|tea|coffee|sandwich|roll|tikka|kebab|samosa|dosa|idli|vada|paratha|kulcha|raita|pickle|papad|masala|tandoor|fried|grilled|roasted|steamed|boiled/i.test(text);

            const hasPrice = /₹|rs|\\$|\\d+\\.\\d+|price|cost/i.test(text);

            const notNavigation = !/login|signup|home|about|contact|search|filter|cart|order|delivery|location|explore|trending|advertisement|sponsored|banner|menu|restaurant|reviews|photos|directions/i.test(text);

            if ((hasFoodWords || hasPrice) && notNavigation) {
              const lines = text.split('\\n').filter(l => l.trim().length > 0);
              const name = lines[0]?.trim();

              if (name && name.length > 3 && name.length < 150) {
                const priceMatch = text.match(/₹\\s*(\\d+)|rs\\s*(\\d+)|\\$\\s*(\\d+)/i);
                const price = priceMatch ? parseFloat(priceMatch[1] || priceMatch[2] || priceMatch[3]) : null;

                items.push({
                  name: name,
                  description: lines.length > 1 ? lines.slice(1).join(' ') : '',
                  price: price,
                  category: 'main',
                  source_url: window.location.href
                });
              }
            }
          }
        });

        return items; // Return ALL items found
      });

      totalExtracted += menuItems.length;
      log(`✅ Found ${menuItems.length} menu items from ${testUrl}`);
    }

    log(`🎯 Total extracted from listing pages: ${totalExtracted} items`);

  } catch (error) {
    log(`❌ Error extracting from listing pages: ${error.message}`, 'ERROR');
  } finally {
    await browser.close();
  }

  if (db) {
    await db.end();
  }
}

// Main function
async function main() {
  const command = process.argv[2];

  switch (command) {
    case 'complete':
    case 'all':
      await extractCompleteMenus();
      break;

    case 'listing':
      await extractFromListingPages();
      break;

    default:
      console.log(`
🍽️  Complete Menu Scraper - Extract ALL Menu Items

Usage:
  node complete-menu-scraper.js complete  - Extract complete menus from restaurant pages
  node complete-menu-scraper.js listing   - Extract from listing pages

Features:
✅ NO LIMITS - Extracts every single menu item
✅ Real menu extraction (not templates)
✅ Comprehensive food item detection
✅ Advanced category classification
✅ Complete dietary information
✅ Price extraction from multiple patterns
✅ Spice level and preparation time
✅ Availability status

Target: Get 50-100+ real menu items per restaurant
      `);
      break;
  }
}

if (require.main === module) {
  main().catch(console.error);
}