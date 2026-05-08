'use strict';
const bcrypt = require('bcryptjs');

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    
    await queryInterface.bulkInsert('Users', [{
      username: 'admin',
      email: 'admin@talynk.com',
      password: hashedPassword,
      role: 'admin',
      phone1: '+250780000000',
      phone2: null,
      isActive: true,
      isFrozen: false,
      totalProfileViews: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    }], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('Users', { email: 'admin@talynk.com' }, {});
  }
}; 