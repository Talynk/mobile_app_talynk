const request = require('supertest');
const app = require('../app');
const { User } = require('../models');

describe('Authentication Tests', () => {
    beforeAll(async () => {
        // Clear users table before tests
        await User.destroy({ where: {} });
    });

    // Test user registration
    test('POST /api/auth/register - Register new user', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({
                username: 'testuser',
                email: 'test@example.com',
                password: 'password123'
            });
        
        expect(res.statusCode).toBe(201);
        expect(res.body).toHaveProperty('status', 'success');
    });

    // Test user login
    test('POST /api/auth/login - Login user', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({
                email: 'test@example.com',
                password: 'password123'
            });
        
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty('token');
    });

    // Test protected route
    test('GET /api/protected - Access protected route', async () => {
        const token = jwt.sign(
            { id: 1, username: 'testuser', role: 'user' },
            process.env.JWT_SECRET
        );

        const res = await request(app)
            .get('/api/protected')
            .set('Authorization', `Bearer ${token}`);
        
        expect(res.statusCode).toBe(200);
    });
}); 