const { Sequelize } = require('sequelize');
require('dotenv').config();
// Get environment variables
const DB_NAME = process.env.DB_NAME;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_HOST = process.env.DB_HOST;
const DB_PORT = process.env.DB_PORT;
const DB_SSL = false;

// Create Sequelize instance
const sequelize = new Sequelize(
    DB_NAME,
    DB_USER, 
    DB_PASSWORD, 
    {
        host: DB_HOST,
        dialect: 'postgres',
        port: DB_PORT,
        logging: false,
        dialectOptions: {
            ssl: DB_SSL ? {
                require: true,
                rejectUnauthorized: false
            } : false
        },
        pool: {
            max: 5,
            min: 0,
            acquire: 30000,
            idle: 10000
        }
    }
);

// Test connection
sequelize.authenticate()
    .then(() => console.log('Database connection established successfully.'))
    .catch(err => console.error('Unable to connect to the database:', err));

module.exports = sequelize;

