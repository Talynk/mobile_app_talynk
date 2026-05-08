const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function testPostCreation() {
  try {
    console.log('🧪 Testing Post Creation...\n');

    // Test post creation with all required fields
    const testPost = await prisma.post.create({
      data: {
        user_id: '37aa4967-8eda-4b2e-b757-8751db0d090e',
        status: 'pending',
        category_id: 69, // R&B / Soul category
        title: 'Test Post Creation',
        description: 'This is a test post to verify the creation works',
        uploadDate: new Date(),
        type: 'text',
        video_url: '',
        content: 'This is the content of the test post'
      }
    });

    console.log('✅ Post created successfully!');
    console.log(`   Post ID: ${testPost.id}`);
    console.log(`   Title: ${testPost.title}`);
    console.log(`   Category ID: ${testPost.category_id}`);
    console.log(`   Type: ${testPost.type}`);
    console.log(`   Status: ${testPost.status}`);

    // Clean up - delete the test post
    await prisma.post.delete({
      where: { id: testPost.id }
    });

    console.log('✅ Test post cleaned up successfully!');

  } catch (error) {
    console.error('❌ Post creation test failed:', error.message);
    if (error.code) {
      console.error(`   Error Code: ${error.code}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Run the test
if (require.main === module) {
  testPostCreation();
}

module.exports = { testPostCreation };
