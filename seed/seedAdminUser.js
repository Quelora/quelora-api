// seedAdminUser.js
require('dotenv').config({ path: '../.env' }); // Ajusta la ruta si es necesario
const mongoose = require('mongoose');
const User = require('../models/User'); // Asegúrate de que la ruta al modelo User sea correcta
const connectDB = require('../db'); // Importa la función connectDB desde db.js

// Obtener los parámetros de la línea de comandos
const [username, password, role] = process.argv.slice(2);

// Validar que se proporcionen los parámetros necesarios
if (!username || !password || !role) {
  console.error('❌ Error: Debes proporcionar un nombre de usuario, una contraseña y un rol.');
  console.log('Uso: node seedAdminUser.js <username> <password> <role>');
  process.exit(1); // Terminar el script con un código de error
}

// Datos del usuario
const newUser = {
  username,
  password,
  role,
};

// Función para crear el usuario
async function createUser() {
  try {
    // Conectar a la base de datos
    await connectDB();

    // Verificar si ya existe un usuario con el mismo nombre
    const existingUser = await User.findOne({ username: newUser.username });
    if (existingUser) {
      console.log('⚠️ El usuario ya existe.');
      return;
    }
    
    // Crear el usuario
    const user = new User(newUser);
    await user.save();

    console.log('✅ Usuario creado exitosamente:', newUser.username);
  } catch (error) {
    console.error('❌ Error creando el usuario:', error.message);
  } finally {
    // Cerrar la conexión a la base de datos
    mongoose.connection.close();
  }
}

// Ejecutar el script
createUser();