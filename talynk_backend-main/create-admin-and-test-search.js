const axios = require('axios');

const BASE_URL = 'http://localhost:3000/api';

async function createAdminAndTestSearch() {
    try {
        console.log('🔧 Creating admin user and testing search...\n');

        // Step 1: Create admin user
        console.log('1️⃣ Creating admin user...');
        try {
            const adminResponse = await axios.post(`${BASE_URL}/admin/register`, {
                email: 'admin@talynk.com',
                username: 'admin',
                password: 'admin123'
            });
            console.log('✅ Admin created successfully');
        } catch (error) {
            if (error.response?.data?.message?.includes('already exists')) {
                console.log('✅ Admin already exists');
            } else {
                console.log('❌ Admin creation failed:', error.response?.data?.message);
                return;
            }
        }

        // Step 2: Login as admin
        console.log('\n2️⃣ Logging in as admin...');
        const loginResponse = await axios.post(`${BASE_URL}/auth/login`, {
            email: 'admin@talynk.com',
            password: 'admin123',
            role: 'admin'
        });

        const token = loginResponse.data.data.accessToken;
        console.log('✅ Admin login successful');

        const headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        };

        // Step 3: Test search functionality
        console.log('\n3️⃣ Testing admin search functionality...');
        
        const searchTests = [
            {
                name: 'Search by Post Title',
                params: { query: 'music', type: 'post_title', page: 1, limit: 5 }
            },
            {
                name: 'Search by Username',
                params: { query: 'user', type: 'username', page: 1, limit: 5 }
            },
            {
                name: 'Search by Status',
                params: { query: 'approved', type: 'status', page: 1, limit: 5 }
            },
            {
                name: 'Search by Date',
                params: { query: '2025-01-07', type: 'date', page: 1, limit: 5 }
            }
        ];

        for (const test of searchTests) {
            console.log(`\n   Testing ${test.name}...`);
            try {
                const response = await axios.get(`${BASE_URL}/admin/posts/search`, {
                    headers,
                    params: test.params
                });

                console.log(`   ✅ ${test.name} successful`);
                console.log(`   Results: ${response.data.data.posts.length} posts found`);
                console.log(`   Total: ${response.data.data.pagination.total}`);
                
                if (response.data.data.posts.length > 0) {
                    const firstPost = response.data.data.posts[0];
                    console.log(`   Sample: ${firstPost.title} by ${firstPost.user?.username || 'Unknown'}`);
                }
            } catch (error) {
                console.log(`   ❌ ${test.name} failed:`, error.response?.data?.message || error.message);
            }
        }

        // Test error cases
        console.log('\n4️⃣ Testing error cases...');
        
        // Test missing parameters
        try {
            await axios.get(`${BASE_URL}/admin/posts/search`, { headers });
            console.log('   ❌ Should have failed with missing parameters');
        } catch (error) {
            console.log('   ✅ Missing parameters correctly rejected');
        }

        // Test invalid search type
        try {
            await axios.get(`${BASE_URL}/admin/posts/search`, {
                headers,
                params: { query: 'test', type: 'invalid_type', page: 1, limit: 5 }
            });
            console.log('   ❌ Should have failed with invalid type');
        } catch (error) {
            console.log('   ✅ Invalid search type correctly rejected');
        }

        // Test invalid date format
        try {
            await axios.get(`${BASE_URL}/admin/posts/search`, {
                headers,
                params: { query: 'invalid-date', type: 'date', page: 1, limit: 5 }
            });
            console.log('   ❌ Should have failed with invalid date');
        } catch (error) {
            console.log('   ✅ Invalid date format correctly rejected');
        }

        // Test invalid status
        try {
            await axios.get(`${BASE_URL}/admin/posts/search`, {
                headers,
                params: { query: 'invalid_status', type: 'status', page: 1, limit: 5 }
            });
            console.log('   ❌ Should have failed with invalid status');
        } catch (error) {
            console.log('   ✅ Invalid status correctly rejected');
        }

        console.log('\n🎉 Admin search testing completed successfully!');

    } catch (error) {
        console.error('❌ Test failed:', error.response?.data || error.message);
    }
}

createAdminAndTestSearch();
