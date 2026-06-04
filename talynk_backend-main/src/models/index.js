'use strict';

const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const basename = path.basename(__filename);
const sequelize = require('../config/database');
const db = {};

// Read all model files and import them
fs.readdirSync(__dirname)
  .filter(file => {
    return (file.indexOf('.') !== 0) && 
           (file !== basename) && 
           (file !== 'associations.js') &&
           (file.slice(-3) === '.js');
  })
  .forEach(file => {
    const model = require(path.join(__dirname, file));
    if (model.name) {
      db[model.name] = model;
      console.log(`Loaded model: ${model.name}`);
    }
  });

// Set up associations after all models are loaded
Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
    console.log(`Set up associations for: ${modelName}`);
  }
});

// Export the db object
db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;

