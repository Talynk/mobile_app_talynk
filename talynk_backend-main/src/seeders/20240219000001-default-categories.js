'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.bulkInsert('Categories', [
      {
        name: 'Entertainment',
        description: 'Entertainment related content',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Education',
        description: 'Educational content and tutorials',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Sports',
        description: 'Sports and athletic content',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Technology',
        description: 'Tech-related content and news',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Music',
        description: 'Music videos and audio content',
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        name: 'Gaming',
        description: 'Gaming content and streams',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.bulkDelete('Categories', null, {});
  }
}; 