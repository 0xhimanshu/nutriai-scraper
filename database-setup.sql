-- NutriAI Database Schema
-- Tables: locations, restaurants, menu_items

CREATE DATABASE IF NOT EXISTS nutriai_dev;
USE nutriai_dev;

-- Locations table
CREATE TABLE IF NOT EXISTS locations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    city VARCHAR(100) NOT NULL,
    country VARCHAR(100) NOT NULL,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_city_country (city, country),
    INDEX idx_city (city),
    INDEX idx_country (country)
);

-- Restaurants table
CREATE TABLE IF NOT EXISTS restaurants (
    id INT AUTO_INCREMENT PRIMARY KEY,
    location_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    address TEXT,
    phone VARCHAR(50),
    website VARCHAR(500),
    rating DECIMAL(3,2),
    price_level INT,
    cuisine_types JSON,
    opening_hours JSON,
    delivery_time VARCHAR(50),
    minimum_order DECIMAL(10,2),
    delivery_fee DECIMAL(10,2),
    platform VARCHAR(50) NOT NULL,
    platform_id VARCHAR(100),
    image_url TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE,
    INDEX idx_location (location_id),
    INDEX idx_platform (platform),
    INDEX idx_rating (rating),
    UNIQUE KEY unique_platform_restaurant (platform, platform_id)
);

-- Menu items table
CREATE TABLE IF NOT EXISTS menu_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    restaurant_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price DECIMAL(10,2),
    original_price DECIMAL(10,2),
    category VARCHAR(100),
    subcategory VARCHAR(100),
    cuisine_type VARCHAR(100),
    ingredients TEXT,
    dietary_info JSON,
    nutritional_info JSON,
    image_url TEXT,
    is_available BOOLEAN DEFAULT TRUE,
    is_popular BOOLEAN DEFAULT FALSE,
    is_recommended BOOLEAN DEFAULT FALSE,
    preparation_time VARCHAR(50),
    spice_level VARCHAR(20),
    portion_size VARCHAR(50),
    calories INT,
    scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
    INDEX idx_restaurant (restaurant_id),
    INDEX idx_category (category),
    INDEX idx_price (price),
    INDEX idx_cuisine (cuisine_type),
    INDEX idx_available (is_available)
);

-- Insert sample locations
INSERT IGNORE INTO locations (city, country, latitude, longitude) VALUES
('Mumbai', 'India', 19.0760, 72.8777),
('Delhi', 'India', 28.7041, 77.1025),
('Bangalore', 'India', 12.9716, 77.5946),
('Dubai', 'UAE', 25.2048, 55.2708),
('Abu Dhabi', 'UAE', 24.4539, 54.3773),
('Sharjah', 'UAE', 25.3573, 55.4033),
('Riyadh', 'Saudi Arabia', 24.7136, 46.6753),
('Jeddah', 'Saudi Arabia', 21.4858, 39.1925),
('Kuwait City', 'Kuwait', 29.3759, 47.9774),
('Manama', 'Bahrain', 26.0667, 50.5577),
('Doha', 'Qatar', 25.2760, 51.5200);

-- Show created tables
SHOW TABLES;