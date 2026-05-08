const request = require('supertest');
const app = require('../src/app');
const { Post, User, Approver } = require('../src/models');
const jwt = require('jsonwebtoken');

describe('Approver Functionality Tests', () => {
    let approverToken;
    let testPost;

    beforeAll(async () => {
        // Create test approver
        const approver = await Approver.create({
            username: 'testapprover',
            email: 'testapprover@test.com',
            password: 'hashedpassword'
        });

        approverToken = jwt.sign(
            { username: approver.username },
            process.env.JWT_SECRET
        );

        // Create test post
        testPost = await Post.create({
            title: 'Test Video',
            post_status: 'pending',
            uploaderID: 'testuser',
            uniqueTraceability_id: 'test123'
        });
    });

    describe('Authentication and Authorization', () => {
        test('Should reject requests without token', async () => {
            const response = await request(app)
                .get('/api/approver/posts/pending');
            
            expect(response.status).toBe(401);
        });

        test('Should reject non-approver users', async () => {
            const userToken = jwt.sign(
                { username: 'regularuser' },
                process.env.JWT_SECRET
            );

            const response = await request(app)
                .get('/api/approver/posts/pending')
                .set('Authorization', `Bearer ${userToken}`);
            
            expect(response.status).toBe(403);
        });
    });

    describe('Post Review Functionality', () => {
        test('Should list pending posts', async () => {
            const response = await request(app)
                .get('/api/approver/posts/pending')
                .set('Authorization', `Bearer ${approverToken}`);
            
            expect(response.status).toBe(200);
            expect(response.body.data.posts).toBeDefined();
            expect(Array.isArray(response.body.data.posts)).toBeTruthy();
        });

        test('Should approve post with valid data', async () => {
            const response = await request(app)
                .put(`/api/approver/posts/${testPost.uniqueTraceability_id}/approve`)
                .set('Authorization', `Bearer ${approverToken}`)
                .send({
                    notes: 'Content approved - meets guidelines'
                });
            
            expect(response.status).toBe(200);
            expect(response.body.status).toBe('success');
        });

        test('Should reject post with invalid data', async () => {
            const response = await request(app)
                .put(`/api/approver/posts/${testPost.uniqueTraceability_id}/reject`)
                .set('Authorization', `Bearer ${approverToken}`)
                .send({
                    notes: '' // Invalid - notes required for rejection
                });
            
            expect(response.status).toBe(400);
        });
    });

    describe('Report Generation', () => {
        test('Should generate PDF report', async () => {
            const response = await request(app)
                .post('/api/approver/reports')
                .set('Authorization', `Bearer ${approverToken}`)
                .send({
                    reportType: 'daily',
                    format: 'pdf',
                    metrics: ['approvals', 'rejections']
                });
            
            expect(response.status).toBe(200);
            expect(response.headers['content-type']).toBe('application/pdf');
        });

        test('Should validate report parameters', async () => {
            const response = await request(app)
                .post('/api/approver/reports')
                .set('Authorization', `Bearer ${approverToken}`)
                .send({
                    reportType: 'invalid',
                    format: 'pdf',
                    metrics: ['approvals']
                });
            
            expect(response.status).toBe(400);
        });
    });

    afterAll(async () => {
        // Cleanup
        await Post.destroy({ where: { uniqueTraceability_id: 'test123' } });
        await Approver.destroy({ where: { username: 'testapprover' } });
    });
}); 