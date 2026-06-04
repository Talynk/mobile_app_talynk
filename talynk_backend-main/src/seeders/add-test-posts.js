module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Get a user to associate with posts
    const users = await queryInterface.sequelize.query(
      'SELECT id FROM Users LIMIT 1;'
    );
    const userId = users[0][0]?.id;

    if (!userId) {
      console.log('No users found, creating posts without user association');
    }

    return queryInterface.bulkInsert('Posts', [
      {
        id: '1abc-def4-5678',
        title: 'Test Video 1',
        caption: 'This is a test video',
        post_category: 'entertainment',
        file_url: 'https://example.com/test1.mp4',
        likes: 150,
        shares: 25,
        comments: 42,
        status: 'approved',
        created_at: new Date(),
        updated_at: new Date(),
        userId: userId || null
      },
      {
        id: '2xyz-uvw7-8901',
        title: 'Test Image 1',
        caption: 'This is a test image',
        post_category: 'art',
        file_url: 'https://example.com/test1.jpg',
        likes: 75,
        shares: 12,
        comments: 8,
        status: 'approved',
        created_at: new Date(),
        updated_at: new Date(),
        userId: userId || null
      }
    ]);
  },

  down: (queryInterface, Sequelize) => {
    return queryInterface.bulkDelete('Posts', null, {});
  }
}; 