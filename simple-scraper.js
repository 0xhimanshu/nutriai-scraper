#!/usr/bin/env node

/**
 * Simple NutriAI Data Scraper - Outputs to JSON files
 * No database required
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs').promises;

// Configuration
const CONFIG = {
  GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY,

  // Test with a few cities first
  CITIES: [
    { name: 'Mumbai', country: 'India', lat: 19.0760, lng: 72.8777 },
    { name: 'Delhi', country: 'India', lat: 28.7041, lng: 77.1025 },
    { name: 'Dubai', country: 'UAE', lat: 25.2048, lng: 55.2708 }
  ]
};

// Logging function
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${message}`);
}

// Google Places API functions
async function searchRestaurants(city, nextPageToken = null) {
  try {
    const baseUrl = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
    const query = `restaurants in ${city.name}, ${city.country}`;

    const params = {
      query,
      key: CONFIG.GOOGLE_PLACES_API_KEY,
      type: 'restaurant'
    };

    if (nextPageToken) {
      params.pagetoken = nextPageToken;
    }

    const response = await axios.get(baseUrl, { params });

    if (response.data.status !== 'OK' && response.data.status !== 'ZERO_RESULTS') {
      throw new Error(`Google Places API error: ${response.data.status}`);
    }

    return {
      results: response.data.results || [],
      nextPageToken: response.data.next_page_token || null
    };

  } catch (error) {
    log(`Error searching restaurants in ${city.name}: ${error.message}`, 'ERROR');
    return { results: [], nextPageToken: null };
  }
}

async function getPlaceDetails(placeId) {
  try {
    const baseUrl = 'https://maps.googleapis.com/maps/api/place/details/json';
    const params = {
      place_id: placeId,
      key: CONFIG.GOOGLE_PLACES_API_KEY,
      fields: 'name,formatted_address,formatted_phone_number,website,rating,price_level,opening_hours,geometry,types,reviews'
    };

    const response = await axios.get(baseUrl, { params });

    if (response.data.status !== 'OK') {
      throw new Error(`Place details error: ${response.data.status}`);
    }

    return response.data.result;

  } catch (error) {
    log(`Error getting place details for ${placeId}: ${error.message}`, 'ERROR');
    return null;
  }
}

// Main scraping function
async function scrapeRestaurantData() {
  log('🚀 Starting NutriAI restaurant data scraping...');

  if (!CONFIG.GOOGLE_PLACES_API_KEY || CONFIG.GOOGLE_PLACES_API_KEY === 'YOUR_GOOGLE_PLACES_API_KEY') {
    log('❌ Google Places API key not found. Please check your .env file.', 'ERROR');
    return;
  }

  const allRestaurants = [];

  for (const city of CONFIG.CITIES) {
    log(`🏙️  Scraping restaurants in ${city.name}, ${city.country}...`);

    let nextPageToken = null;
    let pageCount = 0;
    const maxPages = 3; // Limit to avoid too many API calls

    do {
      const searchResult = await searchRestaurants(city, nextPageToken);
      pageCount++;

      log(`📄 Processing page ${pageCount} - Found ${searchResult.results.length} restaurants`);

      for (const restaurant of searchResult.results) {
        // Get detailed information
        const details = await getPlaceDetails(restaurant.place_id);

        if (details) {
          const restaurantData = {
            place_id: restaurant.place_id,
            name: details.name,
            address: details.formatted_address,
            phone: details.formatted_phone_number || '',
            website: details.website || '',
            rating: details.rating || 0,
            price_level: details.price_level || 0,
            latitude: details.geometry?.location?.lat || 0,
            longitude: details.geometry?.location?.lng || 0,
            city: city.name,
            country: city.country,
            cuisine_types: details.types || [],
            opening_hours: details.opening_hours?.weekday_text || [],
            reviews_count: details.reviews?.length || 0,
            scraped_at: new Date().toISOString()
          };

          allRestaurants.push(restaurantData);
          log(`✅ Saved: ${restaurantData.name}`);
        }

        // Small delay to respect API limits
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      nextPageToken = searchResult.nextPageToken;

      // Wait between pages (required by Google Places API)
      if (nextPageToken && pageCount < maxPages) {
        log('⏳ Waiting before next page...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

    } while (nextPageToken && pageCount < maxPages);

    log(`🏁 Completed ${city.name}: ${allRestaurants.filter(r => r.city === city.name).length} restaurants`);
  }

  // Save to JSON file
  const outputFile = `restaurants_${new Date().toISOString().split('T')[0]}.json`;
  await fs.writeFile(outputFile, JSON.stringify(allRestaurants, null, 2));

  log(`📁 Saved ${allRestaurants.length} restaurants to ${outputFile}`);
  log('🎉 Restaurant scraping completed!');

  return allRestaurants;
}

// Main function
async function main() {
  const command = process.argv[2];

  switch (command) {
    case 'restaurants':
      await scrapeRestaurantData();
      break;

    default:
      console.log(`
🤖 Simple NutriAI Data Scraper

Usage:
  node simple-scraper.js restaurants

This version outputs to JSON files instead of a database.
      `);
      break;
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
}