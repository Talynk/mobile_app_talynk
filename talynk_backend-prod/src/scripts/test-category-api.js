const axios = require('axios');

const BASE_URL = 'http://localhost:3000/api';

async function testCategoryAPI() {
  try {
    console.log('🧪 Testing Category API Endpoints...\n');

    // Test 1: Get all categories with hierarchy
    console.log('1️⃣ Testing GET /api/categories');
    try {
      const response = await axios.get(`${BASE_URL}/categories`);
      console.log('✅ Success:', response.data.status);
      console.log(`   Found ${response.data.data.length} main categories`);
      
      // Display hierarchy
      response.data.data.forEach(mainCategory => {
        console.log(`   📁 ${mainCategory.name} (${mainCategory.children.length} subcategories)`);
        mainCategory.children.slice(0, 3).forEach(sub => {
          console.log(`      └── ${sub.name}`);
        });
        if (mainCategory.children.length > 3) {
          console.log(`      └── ... and ${mainCategory.children.length - 3} more`);
        }
      });
    } catch (error) {
      console.log('❌ Error:', error.response?.data?.message || error.message);
    }

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 2: Get subcategories for Music category
    console.log('2️⃣ Testing GET /api/categories/63/subcategories');
    try {
      const response = await axios.get(`${BASE_URL}/categories/63/subcategories`);
      console.log('✅ Success:', response.data.status);
      console.log(`   Found ${response.data.data.length} Music subcategories:`);
      response.data.data.forEach(sub => {
        console.log(`   - ${sub.name} (${sub._count.posts} posts)`);
      });
    } catch (error) {
      console.log('❌ Error:', error.response?.data?.message || error.message);
    }

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 3: Get specific category by ID
    console.log('3️⃣ Testing GET /api/categories/66 (Rock category)');
    try {
      const response = await axios.get(`${BASE_URL}/categories/66`);
      console.log('✅ Success:', response.data.status);
      console.log(`   Category: ${response.data.data.name}`);
      console.log(`   Description: ${response.data.data.description}`);
      console.log(`   Level: ${response.data.data.level}`);
      console.log(`   Parent ID: ${response.data.data.parent_id}`);
    } catch (error) {
      console.log('❌ Error:', error.response?.data?.message || error.message);
    }

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 4: Get popular categories
    console.log('4️⃣ Testing GET /api/categories/popular');
    try {
      const response = await axios.get(`${BASE_URL}/categories/popular`);
      console.log('✅ Success:', response.data.status);
      console.log(`   Found ${response.data.data.length} popular categories:`);
      response.data.data.forEach(category => {
        console.log(`   - ${category.name} (${category._count.posts} posts)`);
      });
    } catch (error) {
      console.log('❌ Error:', error.response?.data?.message || error.message);
    }

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 5: Test category filtering in posts
    console.log('5️⃣ Testing GET /api/posts?category=63 (Music category)');
    try {
      const response = await axios.get(`${BASE_URL}/posts?category=63&limit=5`);
      console.log('✅ Success:', response.data.status);
      console.log(`   Found ${response.data.data.length} posts in Music category`);
      response.data.data.forEach(post => {
        console.log(`   - ${post.title} (Category: ${post.category?.name || 'Unknown'})`);
      });
    } catch (error) {
      console.log('❌ Error:', error.response?.data?.message || error.message);
    }

    console.log('\n🎉 Category API testing completed!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the tests
if (require.main === module) {
  testCategoryAPI();
}

module.exports = { testCategoryAPI };
