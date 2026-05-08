const request = require('supertest');
const app = require('../app');
const jwt = require('jsonwebtoken');

describe('Admin Routes Tests', () => {
    let adminToken;

    beforeAll(() => {
        // Create admin token for testing
        adminToken = jwt.sign(
            { id: 1, username: 'admin', role: 'admin' },
            process.env.JWT_SECRET
        );
    });

    test('GET /api/admin/users - Get all users', async () => {
        const res = await request(app)
            .get('/api/admin/users')
            .set('Authorization', `Bearer ${adminToken}`);
        
        expect(res.statusCode).toBe(200);
        expect(Array.isArray(res.body.data)).toBe(true);
    });

    test('POST /api/admin/approvers - Register new approver', async () => {
        const res = await request(app)
            .post('/api/admin/approvers')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                username: 'newapprover',
                email: 'approver@example.com',
                password: 'approver123'
            });
        
        expect(res.statusCode).toBe(201);
    });
}); 