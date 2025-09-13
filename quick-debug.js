#!/usr/bin/env node

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

async function quickTest() {
  console.log('🔍 Quick debug test...');

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    console.log('📍 Testing Zomato...');
    await page.goto('https://www.zomato.com/mumbai/restaurants', { waitUntil: 'domcontentloaded', timeout: 15000 });

    await new Promise(resolve => setTimeout(resolve, 3000));

    const info = await page.evaluate(() => {
      return {
        title: document.title,
        bodyLength: document.body.innerText.length,
        hasRestaurantText: /restaurant/i.test(document.body.innerText),
        elementCounts: {
          divs: document.querySelectorAll('div').length,
          articles: document.querySelectorAll('article').length,
          sections: document.querySelectorAll('section').length
        }
      };
    });

    console.log('Zomato results:', info);

    // Try a simple restaurant list page
    console.log('\n📍 Testing simple food site...');
    await page.goto('https://www.foodpanda.com', { waitUntil: 'domcontentloaded', timeout: 15000 });

    await new Promise(resolve => setTimeout(resolve, 2000));

    const foodpandaInfo = await page.evaluate(() => {
      return {
        title: document.title,
        hasFoodText: /food|restaurant/i.test(document.body.innerText),
        bodyPreview: document.body.innerText.substring(0, 200)
      };
    });

    console.log('Foodpanda results:', foodpandaInfo);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await browser.close();
  }
}

quickTest().catch(console.error);