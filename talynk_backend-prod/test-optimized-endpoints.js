const axios = require('axios');

// Configuration
const BASE_URL = 'http://localhost:3000/api';
const TEST_USER_TOKEN = 'your-test-jwt-token'; // Replace with actual token

// Test configuration
const testConfig = {
    featuredPosts: {
        endpoint: '/featured',
        params: { page: 1, limit: 5, sort: 'newest' }
    },
    followingPosts: {
        endpoint: '/posts/following',
        params: { page: 1, limit: 10, sort: 'newest' },
        requiresAuth: true
    },
    optimizedFeed: {
        endpoint: '/posts/feed',
        params: { page: 1, limit: 15, includeFeatured: true, includeFollowing: true },
        requiresAuth: true
    }
};

// Helper function to make requests
async function makeRequest(endpoint, params = {}, requiresAuth = false) {
    try {
        const config = {
            method: 'GET',
            url: `${BASE_URL}${endpoint}`,
            params,
            headers: requiresAuth ? { 'Authorization': `Bearer ${TEST_USER_TOKEN}` } : {}
        };

        console.log(`\n🔍 Testing: ${endpoint}`);
        console.log(`📋 Params:`, params);
        
        const startTime = Date.now();
        const response = await axios(config);
        const endTime = Date.now();
        
        console.log(`✅ Status: ${response.status}`);
        console.log(`⏱️  Response Time: ${endTime - startTime}ms`);
        console.log(`📊 Cached: ${response.data.cached || false}`);
        console.log(`📈 Data Count: ${response.data.data?.posts?.length || response.data.data?.featuredPosts?.length || 0}`);
        
        return response.data;
    } catch (error) {
        console.error(`❌ Error testing ${endpoint}:`, error.response?.data || error.message);
        return null;
    }
}

// Test cache performance
async function testCachePerformance() {
    console.log('\n🚀 Testing Cache Performance...');
    
    const endpoint = '/featured';
    const params = { page: 1, limit: 5, sort: 'newest' };
    
    // First request (should be slow - cache miss)
    console.log('\n📥 First Request (Cache Miss):');
    const start1 = Date.now();
    await makeRequest(endpoint, params);
    const time1 = Date.now() - start1;
    
    // Second request (should be fast - cache hit)
    console.log('\n📥 Second Request (Cache Hit):');
    const start2 = Date.now();
    await makeRequest(endpoint, params);
    const time2 = Date.now() - start2;
    
    console.log(`\n📊 Performance Comparison:`);
    console.log(`   First Request: ${time1}ms`);
    console.log(`   Second Request: ${time2}ms`);
    console.log(`   Improvement: ${((time1 - time2) / time1 * 100).toFixed(1)}%`);
}

// Test all endpoints
async function testAllEndpoints() {
    console.log('🧪 Testing Optimized Posts API Endpoints\n');
    
    // Test featured posts (no auth required)
    await makeRequest(testConfig.featuredPosts.endpoint, testConfig.featuredPosts.params);
    
    // Test following posts (auth required)
    await makeRequest(testConfig.followingPosts.endpoint, testConfig.followingPosts.params, testConfig.followingPosts.requiresAuth);
    
    // Test optimized feed (auth required)
    await makeRequest(testConfig.optimizedFeed.endpoint, testConfig.optimizedFeed.params, testConfig.optimizedFeed.requiresAuth);
}

// Test pagination
async function testPagination() {
    console.log('\n📄 Testing Pagination...');
    
    const endpoint = '/featured';
    
    // Test first page
    console.log('\n📄 Page 1:');
    await makeRequest(endpoint, { page: 1, limit: 3 });
    
    // Test second page
    console.log('\n📄 Page 2:');
    await makeRequest(endpoint, { page: 2, limit: 3 });
}

// Test sorting
async function testSorting() {
    console.log('\n🔄 Testing Sorting...');
    
    const endpoint = '/featured';
    
    // Test newest first
    console.log('\n🔄 Newest First:');
    await makeRequest(endpoint, { page: 1, limit: 3, sort: 'newest' });
    
    // Test oldest first
    console.log('\n🔄 Oldest First:');
    await makeRequest(endpoint, { page: 1, limit: 3, sort: 'oldest' });
}

// Main test function
async function runTests() {
    try {
        console.log('🎯 Starting Optimized Posts API Tests\n');
        
        // Test all endpoints
        await testAllEndpoints();
        
        // Test pagination
        await testPagination();
        
        // Test sorting
        await testSorting();
        
        // Test cache performance
        await testCachePerformance();
        
        console.log('\n✅ All tests completed!');
        
    } catch (error) {
        console.error('❌ Test suite failed:', error.message);
    }
}

// Run tests if this file is executed directly
if (require.main === module) {
    runTests();
}

module.exports = {
    runTests,
    testAllEndpoints,
    testPagination,
    testSorting,
    testCachePerformance
};


