-- Enhanced Location-Aware Database Schema for NutriAI
-- Supports precise locations: Country -> City -> Area -> Restaurant -> Menu Items

USE nutriai_dev;

-- Drop existing foreign key constraints
ALTER TABLE restaurants DROP FOREIGN KEY restaurants_ibfk_1;
ALTER TABLE menu_items DROP FOREIGN KEY menu_items_ibfk_1;

-- Enhanced locations table with hierarchical structure
ALTER TABLE locations ADD COLUMN area VARCHAR(200) AFTER city;
ALTER TABLE locations ADD COLUMN neighborhood VARCHAR(200) AFTER area;
ALTER TABLE locations ADD COLUMN postal_code VARCHAR(20) AFTER neighborhood;
ALTER TABLE locations ADD COLUMN full_address TEXT AFTER postal_code;

-- Update unique key to include area
ALTER TABLE locations DROP INDEX unique_city_country;
ALTER TABLE locations ADD UNIQUE KEY unique_location (city, country, area, neighborhood);

-- Add location hierarchy columns to restaurants
ALTER TABLE restaurants ADD COLUMN area VARCHAR(200) AFTER location_id;
ALTER TABLE restaurants ADD COLUMN neighborhood VARCHAR(200) AFTER area;
ALTER TABLE restaurants ADD COLUMN exact_latitude DECIMAL(10, 8) AFTER neighborhood;
ALTER TABLE restaurants ADD COLUMN exact_longitude DECIMAL(11, 8) AFTER exact_latitude;
ALTER TABLE restaurants ADD COLUMN full_address TEXT AFTER exact_longitude;
ALTER TABLE restaurants ADD COLUMN postal_code VARCHAR(20) AFTER full_address;

-- Add indexes for location-based queries
ALTER TABLE restaurants ADD INDEX idx_area (area);
ALTER TABLE restaurants ADD INDEX idx_neighborhood (neighborhood);
ALTER TABLE restaurants ADD INDEX idx_exact_location (exact_latitude, exact_longitude);
ALTER TABLE restaurants ADD INDEX idx_city_area (location_id, area);

-- Re-add foreign key constraints
ALTER TABLE restaurants ADD FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE;
ALTER TABLE menu_items ADD FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE;

-- Insert sample enhanced locations for major cities with areas

-- Mumbai areas
INSERT IGNORE INTO locations (city, country, area, neighborhood, latitude, longitude) VALUES
('Mumbai', 'India', 'Bandra', 'Bandra West', 19.0596, 72.8295),
('Mumbai', 'India', 'Bandra', 'Bandra East', 19.0625, 72.8425),
('Mumbai', 'India', 'Andheri', 'Andheri West', 19.1358, 72.8265),
('Mumbai', 'India', 'Andheri', 'Andheri East', 19.1197, 72.8464),
('Mumbai', 'India', 'Powai', NULL, 19.1176, 72.9060),
('Mumbai', 'India', 'Juhu', NULL, 19.1075, 72.8263),
('Mumbai', 'India', 'Lower Parel', NULL, 19.0063, 72.8302),
('Mumbai', 'India', 'Worli', NULL, 19.0178, 72.8172),
('Mumbai', 'India', 'Malad', 'Malad West', 19.1860, 72.8489),
('Mumbai', 'India', 'Goregaon', 'Goregaon West', 19.1663, 72.8526);

-- Delhi areas
INSERT IGNORE INTO locations (city, country, area, neighborhood, latitude, longitude) VALUES
('Delhi', 'India', 'Connaught Place', NULL, 28.6315, 77.2167),
('Delhi', 'India', 'Karol Bagh', NULL, 28.6517, 77.1910),
('Delhi', 'India', 'Lajpat Nagar', NULL, 28.5677, 77.2431),
('Delhi', 'India', 'Nehru Place', NULL, 28.5495, 77.2500),
('Delhi', 'India', 'Khan Market', NULL, 28.5984, 77.2319),
('Delhi', 'India', 'Saket', NULL, 28.5244, 77.2066),
('Delhi', 'India', 'Vasant Kunj', NULL, 28.5212, 77.1581),
('Delhi', 'India', 'Rajouri Garden', NULL, 28.6496, 77.1198),
('Delhi', 'India', 'Janakpuri', NULL, 28.6219, 77.0836),
('Delhi', 'India', 'Dwarka', NULL, 28.5921, 77.0460);

-- Bangalore areas
INSERT IGNORE INTO locations (city, country, area, neighborhood, latitude, longitude) VALUES
('Bangalore', 'India', 'Koramangala', NULL, 12.9352, 77.6245),
('Bangalore', 'India', 'Indiranagar', NULL, 12.9719, 77.6412),
('Bangalore', 'India', 'Whitefield', NULL, 12.9698, 77.7500),
('Bangalore', 'India', 'Electronic City', NULL, 12.8456, 77.6603),
('Bangalore', 'India', 'BTM Layout', NULL, 12.9165, 77.6101),
('Bangalore', 'India', 'Jayanagar', NULL, 12.9279, 77.5937),
('Bangalore', 'India', 'HSR Layout', NULL, 12.9082, 77.6476),
('Bangalore', 'India', 'Marathahalli', NULL, 12.9591, 77.6974),
('Bangalore', 'India', 'Bannerghatta Road', NULL, 12.9004, 77.6047),
('Bangalore', 'India', 'Sarjapur Road', NULL, 12.9010, 77.6810);

-- Dubai areas
INSERT IGNORE INTO locations (city, country, area, neighborhood, latitude, longitude) VALUES
('Dubai', 'UAE', 'Downtown Dubai', NULL, 25.1972, 55.2744),
('Dubai', 'UAE', 'Dubai Marina', NULL, 25.0772, 55.1392),
('Dubai', 'UAE', 'Jumeirah', 'Jumeirah 1', 25.2285, 55.2593),
('Dubai', 'UAE', 'Jumeirah', 'Jumeirah Beach Residence', 25.0869, 55.1411),
('Dubai', 'UAE', 'Business Bay', NULL, 25.1872, 55.2631),
('Dubai', 'UAE', 'DIFC', NULL, 25.2138, 55.2817),
('Dubai', 'UAE', 'Deira', NULL, 25.2697, 55.3094),
('Dubai', 'UAE', 'Bur Dubai', NULL, 25.2632, 55.2972),
('Dubai', 'UAE', 'Karama', NULL, 25.2423, 55.3038),
('Dubai', 'UAE', 'Al Barsha', NULL, 25.1146, 55.1964);

-- Abu Dhabi areas
INSERT IGNORE INTO locations (city, country, area, neighborhood, latitude, longitude) VALUES
('Abu Dhabi', 'UAE', 'Corniche', NULL, 24.4648, 54.3618),
('Abu Dhabi', 'UAE', 'Al Zahiyah', NULL, 24.4945, 54.3896),
('Abu Dhabi', 'UAE', 'Al Khalidiyah', NULL, 24.4508, 54.3534),
('Abu Dhabi', 'UAE', 'Marina Mall', NULL, 24.4736, 54.3188),
('Abu Dhabi', 'UAE', 'Yas Island', NULL, 24.4672, 54.6033),
('Abu Dhabi', 'UAE', 'Saadiyat Island', NULL, 24.5570, 54.4345);

-- Riyadh areas
INSERT IGNORE INTO locations (city, country, area, neighborhood, latitude, longitude) VALUES
('Riyadh', 'Saudi Arabia', 'Olaya', NULL, 24.6944, 46.6847),
('Riyadh', 'Saudi Arabia', 'Al Malaz', NULL, 24.6408, 46.7028),
('Riyadh', 'Saudi Arabia', 'King Fahd District', NULL, 24.7419, 46.6758),
('Riyadh', 'Saudi Arabia', 'Al Tahlia', NULL, 24.7008, 46.6745),
('Riyadh', 'Saudi Arabia', 'Diplomatic Quarter', NULL, 24.6909, 46.6219);

-- Jeddah areas
INSERT IGNORE INTO locations (city, country, area, neighborhood, latitude, longitude) VALUES
('Jeddah', 'Saudi Arabia', 'Al Balad', NULL, 21.4816, 39.1831),
('Jeddah', 'Saudi Arabia', 'Al Hamra', NULL, 21.5520, 39.1669),
('Jeddah', 'Saudi Arabia', 'Al Andalus', NULL, 21.5433, 39.2267),
('Jeddah', 'Saudi Arabia', 'Al Rawdah', NULL, 21.5535, 39.1735);

SHOW TABLES;