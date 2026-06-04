const request = require('supertest');
const app = require('../app');
const prisma = require('../lib/prisma');

// Mock email sending so tests don't call external Resend API
jest.mock('../services/emailService', () => ({
  sendOTPEmail: jest.fn().mockResolvedValue({ id: 'test-email', status: 'sent' }),
  sendPasswordResetEmail: jest.fn().mockResolvedValue({ id: 'test-reset-email', status: 'sent' }),
}));

describe('OTP-based registration flow (E2E)', () => {
  const testEmail = 'e2e-otp-user@example.com';
  const password = 'StrongPass123!';
  const baseUsername = 'e2e_user';

  beforeAll(async () => {
    // Clean up any previous test data
    await prisma.otp.deleteMany({
      where: { email: testEmail.toLowerCase() },
    });
    await prisma.user.deleteMany({
      where: { email: testEmail.toLowerCase() },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  test('full registration + login flow works', async () => {
    // Step 1: request OTP
    const reqOtpRes = await request(app)
      .post('/api/auth/register/request-otp')
      .send({ email: testEmail });

    expect(reqOtpRes.statusCode).toBe(200);
    expect(reqOtpRes.body).toHaveProperty('status', 'success');

    // Read OTP from DB
    const otpRecord = await prisma.otp.findFirst({
      where: {
        email: testEmail.toLowerCase(),
        type: 'EMAIL_VERIFICATION',
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    expect(otpRecord).toBeTruthy();
    expect(otpRecord.code).toHaveLength(6);

    // Step 2: verify OTP
    const verifyRes = await request(app)
      .post('/api/auth/register/verify-otp')
      .send({
        email: testEmail,
        otpCode: otpRecord.code,
      });

    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.body).toHaveProperty('status', 'success');
    const verificationToken =
      verifyRes.body?.data?.verificationToken || verifyRes.body?.data?.token;
    expect(verificationToken).toBeTruthy();

    // Step 3: complete registration
    const username = `${baseUsername}_${Date.now()}`;

    const completeRes = await request(app)
      .post('/api/auth/register/complete')
      .send({
        verificationToken,
        username,
        password,
        display_name: 'E2E Test User',
      });

    expect([200, 201]).toContain(completeRes.statusCode);
    expect(completeRes.body).toHaveProperty('status', 'success');
    expect(completeRes.body.data?.user?.email).toBe(testEmail.toLowerCase());

    // Final step: login with email + password
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({
        email: testEmail,
        password,
        role: 'user',
      });

    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.body).toHaveProperty('status', 'success');
    expect(loginRes.body.data).toHaveProperty('accessToken');
    expect(loginRes.body.data.user).toMatchObject({
      email: testEmail.toLowerCase(),
      username,
      role: 'user',
    });
  });
});









