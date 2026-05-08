const { sequelize } = require('../models');

beforeAll(async () => {
    // Connect to test database
    await sequelize.authenticate();
    // Sync all models
    await sequelize.sync({ force: true });
});

afterAll(async () => {
    // Close database connection
    await sequelize.close();
}); 