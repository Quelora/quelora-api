// SeedProfiles.js
// CID="QU-ME7MZ3WI-3CUPR" TOTAL_PROFILES=10000 node seedFakerUser.js
require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const { ObjectId } = mongoose.Types;
const connectDB = require('../db');
const Profile = require('../models/Profile');
const geohash = require('ngeohash'); // Ensure installation: npm install ngeohash
const crypto = require('crypto');

const BATCH_SIZE = 5000; // Batch size to avoid memory overload
const TOTAL_PROFILES = process.env.TOTAL_PROFILES || 60000; // Total profiles to generate, override via command

// Set to store unique usernames during generation
const usedNames = new Set();

// List of cities with their coordinates (lat, lon)
const CITIES = [
  { name: "Madrid", coords: [40.4168, -3.7038] },
  { name: "Barcelona", coords: [41.3851, 2.1734] },
  { name: "Valencia", coords: [39.4699, -0.3763] },
  { name: "Sevilla", coords: [37.3891, -5.9845] },
  { name: "Bilbao", coords: [43.2630, -2.9350] },
  { name: "Málaga", coords: [36.7213, -4.4213] },
  { name: "Zaragoza", coords: [41.6488, -0.8891] },
  { name: "Murcia", coords: [37.9922, -1.1307] },
  { name: "Palma", coords: [39.5696, 2.6502] },
  { name: "Las Palmas", coords: [28.1235, -15.4363] },
  { name: "París", coords: [48.8566, 2.3522] },
  { name: "Londres", coords: [51.5074, -0.1278] },
  { name: "Berlín", coords: [52.5200, 13.4050] },
  { name: "Roma", coords: [41.9028, 12.4964] },
  { name: "Lisboa", coords: [38.7223, -9.1393] },
  { name: "Nueva York", coords: [40.7128, -74.0060] },
  { name: "Ciudad de México", coords: [19.4326, -99.1332] },
  { name: "Buenos Aires", coords: [-34.6037, -58.3816] },
  { name: "Santiago", coords: [-33.4489, -70.6693] },
  { name: "Bogotá", coords: [4.7110, -74.0721] }
];

/**
 * Generates random coordinates around a city (~10km spread)
 */
const generateRandomCoords = (baseCoords) => {
  const [lat, lon] = baseCoords;
  // Spread of ~0.1 degrees (approx. 11km)
  const latOffset = (Math.random() - 0.5) * 0.2;
  const lonOffset = (Math.random() - 0.5) * 0.2;
  
  return [
    parseFloat((lat + latOffset).toFixed(6)),
    parseFloat((lon + lonOffset).toFixed(6))
  ];
};

/**
 * Generates a sha256 ID
 */
const generateUniqueNumericId = () => {
  let id = '';
  while (id.length < 21) {
    id += Math.floor(Math.random() * 10);
  }
  return crypto.createHash('sha256').update(id).digest('hex');
};

/**
 * Generates a unique username based on the ID
 */
const generateUniqueName = (uid) => {
  const baseName = `FakeUser${uid}`;
  let name = baseName;
  let counter = 1;
  
  while (usedNames.has(name)) {
    name = `${baseName}${counter}`;
    counter++;
  }
  
  usedNames.add(name);
  return name;
};

/**
 * Creates a fake profile with realistic geographic data
 */
const createFakeProfile = (index, timestamp) => {
  const uid = generateUniqueNumericId();
  const name = generateUniqueName(index);
  
  // Select a random city
  const city = CITIES[Math.floor(Math.random() * CITIES.length)];
  const [latitude, longitude] = generateRandomCoords(city.coords);
  const geoHash = geohash.encode(latitude, longitude, 9); // 9-character precision
  
  return {
    cid: process.env.CID || 'QU-ME7HF2BN-E8QD9', // Override via command
    author: uid,
    name: name,
    given_name: `Name ${uid.slice(-3)}`,
    family_name: `Surname ${uid.slice(-2)}`,
    picture: `https://i.pravatar.cc/150?img=${(index % 70) + 1}`,
    background: null,
    locale: 'es',
    bookmarksCount: Math.floor(Math.random() * 10),
    commentsCount: Math.floor(Math.random() * 10),
    followersCount: Math.floor(Math.random() * 50),
    followingCount: Math.floor(Math.random() * 50),
    likesCount: Math.floor(Math.random() * 100),
    sharesCount: Math.floor(Math.random() * 20),
    location: {
      city: city.name,
      country: city.name === 'Palma' ? 'Spain' : 
              city.name === 'Las Palmas' ? 'Spain' : 
              city.name.split(', ')[1] || 'Spain',
      coordinates: [longitude, latitude], // GeoJSON uses [lon, lat]
      type: 'Point'
    },
    geohash: geoHash,
    pushSubscriptions: [],
    settings: {
      notifications: {
        web: false,
        email: false,
        push: false,
        newFollowers: true,
        postLikes: true,
        comments: true,
        newPost: true
      },
      privacy: {
        followerApproval: false,
        showActivity: 'everyone',
        _id: new ObjectId()
      },
      interface: {
        defaultLanguage: 'es',
        defaultTheme: 'light'
      },
      session: {
        rememberSession: true,
        _id: new ObjectId()
      }
    },
    lastActivityViewed: timestamp,
    created_at: timestamp,
    updated_at: timestamp,
    __v: 0
  };
};

/**
 * Main function to seed profiles into the database
 */
async function seedProfiles() {
  try {
    // Connect to the database
    await connectDB();

    console.log('⏳ Deleting existing FakeUser profiles...');
    await Profile.deleteMany({ name: { $regex: /^FakeUser/ } });

    // Ensure geospatial index exists
    await Profile.collection.createIndex({ "location.coordinates": "2dsphere" });

    console.log(`⏳ Generating ${TOTAL_PROFILES} fake profiles with geographic data...`);
    const now = new Date();

    // Process in batches for better performance
    for (let i = 0; i < TOTAL_PROFILES; i += BATCH_SIZE) {
      const currentBatchSize = Math.min(BATCH_SIZE, TOTAL_PROFILES - i);
      const batch = [];
      
      // Generate profiles for the current batch
      for (let j = 0; j < currentBatchSize; j++) {
        batch.push(createFakeProfile(i + j, now));
      }

      // Additional uniqueness check for the batch
      const batchNames = batch.map(p => p.name);
      const uniqueBatchNames = new Set(batchNames);
      
      if (batchNames.length !== uniqueBatchNames.size) {
        throw new Error('❌ Duplicate names detected in the current batch');
      }

      // Insert the batch into the database
      await Profile.insertMany(batch);
      console.log(`✅ Inserted ${i + batch.length} profiles...`);
    }

    console.log('🎉 All profiles were successfully inserted with geographic data.');
  } catch (err) {
    console.error('❌ Error inserting profiles:', err.message);
  } finally {
    // Close the database connection and exit
    await mongoose.connection.close();
    process.exit(0); // Exit with success code
  }
}

// Run the script
seedProfiles();