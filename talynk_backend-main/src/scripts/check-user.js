const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function checkUser(userId) {
  try {
    console.log(`🔍 Checking user: ${userId}`);
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        status: true,
        createdAt: true
      }
    });

    if (user) {
      console.log('✅ User found:');
      console.log(`   ID: ${user.id}`);
      console.log(`   Username: ${user.username || 'N/A'}`);
      console.log(`   Email: ${user.email || 'N/A'}`);
      console.log(`   Status: ${user.status}`);
      console.log(`   Created: ${user.createdAt}`);
    } else {
      console.log('❌ User not found');
      
      // Check if there are any users in the database
      const userCount = await prisma.user.count();
      console.log(`   Total users in database: ${userCount}`);
      
      if (userCount > 0) {
        console.log('   Available users:');
        const users = await prisma.user.findMany({
          select: { id: true, username: true, email: true },
          take: 5
        });
        users.forEach(u => {
          console.log(`     - ${u.id} (${u.username || u.email})`);
        });
      }
    }

  } catch (error) {
    console.error('❌ Error checking user:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

// Get user ID from command line argument or use the one from the error
const userId = process.argv[2] || '37aa4967-8eda-4b2e-b757-8751db0d090e';

checkUser(userId);
