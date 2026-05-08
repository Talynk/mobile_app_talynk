// Script to help set up DATABASE_URL for Prisma introspection
//I will be using this script to run the db url in different environments accordingly 
require('dotenv').config();

const DB_NAME = process.env.DB_NAME;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_HOST = process.env.DB_HOST;
const DB_PORT = process.env.DB_PORT;

console.log('Current database configuration:');
console.log('DB_NAME:', DB_NAME || 'NOT SET');
console.log('DB_USER:', DB_USER || 'NOT SET');
console.log('DB_HOST:', DB_HOST || 'NOT SET');
console.log('DB_PORT:', DB_PORT || 'NOT SET');
console.log('DB_PASSWORD:', DB_PASSWORD ? '***SET***' : 'NOT SET');

if (DB_NAME && DB_USER && DB_PASSWORD && DB_HOST && DB_PORT) {
    const DATABASE_URL = `postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=public`;
    console.log('\n✅ DATABASE_URL constructed:');
    console.log(DATABASE_URL.replace(/\/\/.*@/, '//***:***@'));
    
    // Set environment variable for current session
    process.env.DATABASE_LOCAL = DATABASE_URL;
    console.log('\n✅ DATABASE_URL set for current session');
    
    // Export for use in other scripts
    module.exports = { DATABASE_URL };
} else {
    console.log('\n❌ Missing database configuration. Please set the following environment variables:');
    console.log('- DB_NAME');
    console.log('- DB_USER');
    console.log('- DB_PASSWORD');
    console.log('- DB_HOST');
    console.log('- DB_PORT');
    console.log('\nOr create a .env file with these variables.');
}

