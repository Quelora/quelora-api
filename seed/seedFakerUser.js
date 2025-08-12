// SeedProfiles.js

require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const { ObjectId } = mongoose.Types;
const connectDB = require('../db');
const Profile = require('../models/Profile');
const geohash = require('ngeohash'); // Asegúrate de instalar: npm install ngeohash

const BATCH_SIZE = 5000; // Tamaño del lote para evitar saturación de memoria
const TOTAL_PROFILES = 200000; // Total de perfiles a generar

// Conjunto para almacenar nombres de usuario únicos durante la generación
const usedNames = new Set();

// Lista de ciudades con sus coordenadas (lat, lon)
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
 * Genera coordenadas aleatorias alrededor de una ciudad (dispersión de ~10km)
 */
const generateRandomCoords = (baseCoords) => {
  const [lat, lon] = baseCoords;
  // Dispersión de ~0.1 grados (aprox. 11km)
  const latOffset = (Math.random() - 0.5) * 0.2;
  const lonOffset = (Math.random() - 0.5) * 0.2;
  
  return [
    parseFloat((lat + latOffset).toFixed(6)),
    parseFloat((lon + lonOffset).toFixed(6))
  ];
};

/**
 * Genera un ID numérico único de 21 dígitos
 */
const generateUniqueNumericId = () => {
  let id = '';
  while (id.length < 21) {
    id += Math.floor(Math.random() * 10);
  }
  return id;
};

/**
 * Genera un nombre de usuario único basado en el ID
 */
const generateUniqueName = (uid) => {
  const baseName = `FakeUser${uid.slice(-4)}`;
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
 * Crea un perfil falso con datos geográficos realistas
 */
const createFakeProfile = (index, timestamp) => {
  const uid = generateUniqueNumericId();
  const name = generateUniqueName(uid);
  
  // Seleccionar una ciudad aleatoria
  const city = CITIES[Math.floor(Math.random() * CITIES.length)];
  const [latitude, longitude] = generateRandomCoords(city.coords);
  const geoHash = geohash.encode(latitude, longitude, 9); // Precisión de 9 caracteres
  
  return {
    cid: 'QU-MCANRO0C-QSD2Z',
    author: uid,
    name: name,
    given_name: `Nombre ${uid.slice(-3)}`,
    family_name: `Apellido ${uid.slice(-2)}`,
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
      country: city.name === 'Palma' ? 'España' : 
              city.name === 'Las Palmas' ? 'España' : 
              city.name.split(', ')[1] || 'España',
      coordinates: [longitude, latitude], // GeoJSON usa [lon, lat]
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
 * Función principal para sembrar los perfiles en la base de datos
 */
async function seedProfiles() {
  try {
    // Conectar a la base de datos
    await connectDB();

    console.log('⏳ Eliminando perfiles FakeUser existentes...');
    await Profile.deleteMany({ name: { $regex: /^FakeUser/ } });

    // Asegurarse que el índice geoespacial existe
    await Profile.collection.createIndex({ "location.coordinates": "2dsphere" });

    console.log(`⏳ Generando ${TOTAL_PROFILES} perfiles falsos con datos geográficos...`);
    const now = new Date();

    // Procesar en lotes para mejor rendimiento
    for (let i = 0; i < TOTAL_PROFILES; i += BATCH_SIZE) {
      const currentBatchSize = Math.min(BATCH_SIZE, TOTAL_PROFILES - i);
      const batch = [];
      
      // Generar los perfiles del lote actual
      for (let j = 0; j < currentBatchSize; j++) {
        batch.push(createFakeProfile(i + j, now));
      }

      // Verificación adicional de unicidad en el lote
      const batchNames = batch.map(p => p.name);
      const uniqueBatchNames = new Set(batchNames);
      
      if (batchNames.length !== uniqueBatchNames.size) {
        throw new Error('❌ Se detectaron nombres duplicados en el lote actual');
      }

      // Insertar el lote en la base de datos
      await Profile.insertMany(batch);
      console.log(`✅ Insertados ${i + batch.length} perfiles...`);
    }

    console.log('🎉 Todos los perfiles fueron insertados correctamente con datos geográficos.');
  } catch (err) {
    console.error('❌ Error al insertar perfiles:', err.message);
  } finally {
    // Cerrar la conexión a la base de datos
    mongoose.connection.close();
  }
}

// Ejecutar el script
seedProfiles();