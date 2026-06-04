const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function createTestUser() {
  try {
    console.log('👤 Creating test user...');

    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email: 'test@example.com' },
          { username: 'testuser' }
        ]
      }
    });

    if (existingUser) {
      console.log('✅ Test user already exists:');
      console.log(`   ID: ${existingUser.id}`);
      console.log(`   Username: ${existingUser.username}`);
      console.log(`   Email: ${existingUser.email}`);
      return existingUser;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash('password123', 10);

    // Create test user
    const user = await prisma.user.create({
      data: {
        username: 'testuser',
        email: 'test@example.com',
        password: hashedPassword,
        phone1: '+1234567890',
        status: 'active',
        role: 'user'
      }
    });

    console.log('✅ Test user created successfully:');
    console.log(`   ID: ${user.id}`);
    console.log(`   Username: ${user.username}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Status: ${user.status}`);
    console.log(`   Role: ${user.role}`);

    return user;

  } catch (error) {
    console.error('❌ Error creating test user:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
if (require.main === module) {
  createTestUser()
    .then(() => {
      console.log('\n🎉 Test user creation completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Test user creation failed:', error);
      process.exit(1);
    });
}

module.exports = { createTestUser };
