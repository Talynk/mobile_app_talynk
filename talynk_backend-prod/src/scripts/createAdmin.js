const bcrypt = require('bcryptjs');
const { Admin } = require('../models');

async function createTestAdmin() {
    try {
        const hashedPassword = await bcrypt.hash('admin123', 10);
        
        await Admin.create({
            username: 'admin',
            email: 'admin@example.com',
            password: hashedPassword,
            role: 'admin',
            permissions: [
                'manage_users',
                'manage_content',
                'manage_approvers',
                'view_stats'
            ]
        });

        console.log('Test admin created successfully');
    } catch (error) {
        console.error('Error creating test admin:', error);
    }
}

createTestAdmin(); 