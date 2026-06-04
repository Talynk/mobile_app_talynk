require('dotenv').config();

module.exports = {
  development: {
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || 'pll',
    database: process.env.DB_NAME || 'talynk2',
    host: process.env.DB_HOST || 'localhost',
    dialect: 'postgres',
    port: 5432
  },
  test: {
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || 'pll',
    database: process.env.DB_NAME || 'talynk2',
    host: process.env.DB_HOST || 'localhost',
    dialect: 'postgres',
    port: 5432
  },
  production: {
    username: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    dialect: 'postgres',
    dialectOptions: {
      ssl: false
    }
  }
}; 