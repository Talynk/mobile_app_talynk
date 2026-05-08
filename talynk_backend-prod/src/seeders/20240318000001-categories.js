'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('Categories', [
      {
        name: 'Music',
        description: 'Music related content',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Dance',
        description: 'Dance related content',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Comedy',
        description: 'Comedy and funny content',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Education',
        description: 'Educational content',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Sports',
        description: 'Sports related content',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('Categories', null, {});
  }
}; 