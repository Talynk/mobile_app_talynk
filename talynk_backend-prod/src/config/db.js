// const { Pool } = require('pg');

// const pool = new Pool({
//     user: process.env.DB_USER || 'postgres',
//     host: process.env.DB_HOST || 'localhost',
//     database: 'talynk2',
//     password: process.env.DB_PASSWORD || 'your_password',
//     port: process.env.DB_PORT || 5432,
// });


// // Test the connection
// pool.query('SELECT NOW()', (err, res) => {
//     if (err) {
//         console.error('Database connection error:', err);
//     } else {
//         console.log('Database connected successfully');
//     }
// });

// module.exports = {
//     query: (text, params) => pool.query(text, params),
//     pool
// }; 