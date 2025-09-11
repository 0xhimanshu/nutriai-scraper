# NutriAI Data Scraper

Independent data collection system for restaurants and menu information.

## Setup

1. **Install dependencies:**
```bash
npm install axios mysql2
```

2. **Configure API keys in `.env.local`:**
```bash
GOOGLE_PLACES_API_KEY=your_google_places_api_key_here
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=nutriai_dev
```

3. **Make sure MySQL database is running:**
```bash
# Initialize database tables first
curl http://localhost:3000/api/db/init
```

## Usage

### Scrape Restaurant Data
```bash
node scripts/data-scraper.js restaurants
```
This will:
- Use Google Places API to find restaurants in 15+ major cities
- Get detailed information for each restaurant
- Save to `restaurants` table in MySQL
- Process India, UAE, USA, UK initially

### Scrape Menu Data (Future)
```bash
node scripts/data-scraper.js menus
```
Will scrape from:
- Zomato (India)
- Swiggy (India)
- Talabat (UAE)
- DoorDash (USA)
- Uber Eats (Global)
- Deliveroo (UK/UAE)

### Run Everything
```bash
node scripts/data-scraper.js all
```

## Monitoring

- Check scraping progress in `scraping_jobs` table
- Logs are printed to console with timestamps
- Rate limited to avoid API quota issues (1 req/second)

## Cities Covered

**India:** Mumbai, Delhi, Bangalore, Chennai, Hyderabad, Pune
**UAE:** Dubai, Abu Dhabi, Sharjah  
**USA:** New York, Los Angeles, Chicago
**UK:** London, Manchester

## Expected Results

- **Restaurants per city:** 200-2000 depending on size
- **Total restaurants:** 5,000-20,000 across all cities
- **API calls:** ~10,000-50,000 (monitor your Google Places quota)
- **Runtime:** 2-6 hours depending on API rate limits

## Troubleshooting

- **Database errors:** Check MySQL connection and table schema
- **API errors:** Verify Google Places API key and billing
- **Rate limits:** Script auto-handles with delays
- **Memory issues:** Processes in batches of 20 restaurants

Run the scraper overnight for best results!