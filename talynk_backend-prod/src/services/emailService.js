const { Resend } = require('resend');

// Initialize Resend client lazily (only when needed)
let resend = null;

const getResendClient = () => {
    if (!resend) {
        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) {
            throw new Error('RESEND_API_KEY is not configured. Email functionality will not work.');
        }
        resend = new Resend(apiKey);
    }
    return resend;
};

/**
 * Send OTP email for email verification
 * @param {string} email - Recipient email address
 * @param {string} otpCode - 6-digit OTP code
 * @returns {Promise<Object>} - Resend API response
 */
exports.sendOTPEmail = async (email, otpCode) => {
    try {
        // Use verified domain email (support.ihirwe.art is verified in Resend)
        // Default to support@ihirwe.art or use RESEND_FROM_EMAIL if set
        const fromEmail = process.env.RESEND_FROM_EMAIL || 'support@ihirwe.art';
        const appName = process.env.APP_NAME || 'Talynk';
        
        // Plain text version for better deliverability
        const textContent = `
Verify Your ${appName} Account

Thank you for signing up! Please use the verification code below to complete your registration:

${otpCode}

This code will expire in 10 minutes. If you didn't request this code, please ignore this email.

This is an automated email. Please do not reply to this message.
        `.trim();
        
        const resendClient = getResendClient();
        const { data, error } = await resendClient.emails.send({
            from: fromEmail,
            to: [email],
            replyTo: fromEmail, // Proper reply-to header
            subject: `Verify your ${appName} account`,
            text: textContent, // Plain text version (important for deliverability)
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Verify Your Email</title>
                </head>
                <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                        <h1 style="color: white; margin: 0; font-size: 28px;">${appName}</h1>
                    </div>
                    <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e0e0e0; border-top: none;">
                        <h2 style="color: #333; margin-top: 0;">Verify Your Email Address</h2>
                        <p>Thank you for signing up! Please use the verification code below to complete your registration:</p>
                        <div style="background: white; border: 2px dashed #667eea; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0;">
                            <div style="font-size: 36px; font-weight: bold; color: #667eea; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                                ${otpCode}
                            </div>
                        </div>
                        <p style="color: #666; font-size: 14px;">This code will expire in 10 minutes. If you didn't request this code, please ignore this email.</p>
                        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">
                        <p style="color: #999; font-size: 12px; margin: 0;">This is an automated email. Please do not reply to this message.</p>
                    </div>
                </body>
                </html>
            `,
            // Headers and tags to improve deliverability and reduce spam
            headers: {
                'X-Entity-Ref-ID': `otp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            },
            tags: [
                { name: 'category', value: 'email-verification' },
                { name: 'type', value: 'otp' }
            ]
        });

        if (error) {
            console.error('Resend API error:', error);
            throw new Error(`Failed to send email: ${error.message}`);
        }

        return data;
    } catch (error) {
        console.error('Email service error:', error);
        throw error;
    }
};

/**
 * Send password reset email
 * @param {string} email - Recipient email address
 * @param {string} otpCode - 6-digit OTP code
 * @returns {Promise<Object>} - Resend API response
 */
exports.sendPasswordResetEmail = async (email, otpCode) => {
    try {
        // Use verified domain email (support.ihirwe.art is verified in Resend)
        const fromEmail = process.env.RESEND_FROM_EMAIL || 'support@ihirwe.art';
        const appName = process.env.APP_NAME || 'Talynk';
        
        // Plain text version for better deliverability
        const textContent = `
Password Reset Request - ${appName}

You requested to reset your password. Use the code below to proceed:

${otpCode}

This code will expire in 10 minutes. If you didn't request this, please ignore this email.

This is an automated email. Please do not reply to this message.
        `.trim();
        
        const resendClient = getResendClient();
        const { data, error } = await resendClient.emails.send({
            from: fromEmail,
            to: [email],
            replyTo: fromEmail, // Proper reply-to header
            subject: `Reset your ${appName} password`,
            text: textContent, // Plain text version (important for deliverability)
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Reset Your Password</title>
                </head>
                <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                        <h1 style="color: white; margin: 0; font-size: 28px;">${appName}</h1>
                    </div>
                    <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e0e0e0; border-top: none;">
                        <h2 style="color: #333; margin-top: 0;">Password Reset Request</h2>
                        <p>You requested to reset your password. Use the code below to proceed:</p>
                        <div style="background: white; border: 2px dashed #667eea; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0;">
                            <div style="font-size: 36px; font-weight: bold; color: #667eea; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                                ${otpCode}
                            </div>
                        </div>
                        <p style="color: #666; font-size: 14px;">This code will expire in 10 minutes. If you didn't request this, please ignore this email.</p>
                        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">
                        <p style="color: #999; font-size: 12px; margin: 0;">This is an automated email. Please do not reply to this message.</p>
                    </div>
                </body>
                </html>
            `,
            // Headers and tags to improve deliverability and reduce spam
            headers: {
                'X-Entity-Ref-ID': `reset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            },
            tags: [
                { name: 'category', value: 'password-reset' },
                { name: 'type', value: 'otp' }
            ]
        });

        if (error) {
            console.error('Resend API error:', error);
            throw new Error(`Failed to send email: ${error.message}`);
        }

        return data;
    } catch (error) {
        console.error('Email service error:', error);
        throw error;
    }
};

/**
 * Send OTP email for password change (logged-in user changing password)
 * @param {string} email - Recipient email address
 * @param {string} otpCode - 6-digit OTP code
 * @returns {Promise<Object>} - Resend API response
 */
exports.sendPasswordChangeOTPEmail = async (email, otpCode) => {
    try {
        const fromEmail = process.env.RESEND_FROM_EMAIL || 'support@ihirwe.art';
        const appName = process.env.APP_NAME || 'Talynk';

        const textContent = `
Confirm Password Change - ${appName}

You requested to change your password. Use the code below to confirm:

${otpCode}

This code will expire in 10 minutes. If you didn't request this, please secure your account.

This is an automated email. Please do not reply to this message.
        `.trim();

        const resendClient = getResendClient();
        const { data, error } = await resendClient.emails.send({
            from: fromEmail,
            to: [email],
            replyTo: fromEmail,
            subject: `Confirm your ${appName} password change`,
            text: textContent,
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Confirm Password Change</title>
                </head>
                <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                        <h1 style="color: white; margin: 0; font-size: 28px;">${appName}</h1>
                    </div>
                    <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e0e0e0; border-top: none;">
                        <h2 style="color: #333; margin-top: 0;">Confirm Password Change</h2>
                        <p>You requested to change your password. Use the code below to confirm:</p>
                        <div style="background: white; border: 2px dashed #667eea; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0;">
                            <div style="font-size: 36px; font-weight: bold; color: #667eea; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                                ${otpCode}
                            </div>
                        </div>
                        <p style="color: #666; font-size: 14px;">This code will expire in 10 minutes. If you didn't request this, please secure your account.</p>
                        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">
                        <p style="color: #999; font-size: 12px; margin: 0;">This is an automated email. Please do not reply to this message.</p>
                    </div>
                </body>
                </html>
            `,
            headers: {
                'X-Entity-Ref-ID': `pwd-change-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            },
            tags: [
                { name: 'category', value: 'password-change' },
                { name: 'type', value: 'otp' }
            ]
        });

        if (error) {
            console.error('Resend API error:', error);
            throw new Error(`Failed to send email: ${error.message}`);
        }
        return data;
    } catch (error) {
        console.error('Email service error:', error);
        throw error;
    }
};

/**
 * Send OTP email for account deletion confirmation
 * @param {string} email - Recipient email address
 * @param {string} otpCode - 6-digit OTP code
 * @returns {Promise<Object>} - Resend API response
 */
exports.sendAccountDeletionOTPEmail = async (email, otpCode) => {
    try {
        const fromEmail = process.env.RESEND_FROM_EMAIL || 'support@ihirwe.art';
        const appName = process.env.APP_NAME || 'Talynk';

        const textContent = `
Confirm Account Deletion - ${appName}

You requested to delete your account. Use the code below to verify:

${otpCode}

This code will expire in 10 minutes. If you didn't request this, please secure your account immediately.

This is an automated email. Please do not reply to this message.
        `.trim();

        const resendClient = getResendClient();
        const { data, error } = await resendClient.emails.send({
            from: fromEmail,
            to: [email],
            replyTo: fromEmail,
            subject: `Confirm your ${appName} account deletion`,
            text: textContent,
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Confirm Account Deletion</title>
                </head>
                <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                        <h1 style="color: white; margin: 0; font-size: 28px;">${appName}</h1>
                    </div>
                    <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e0e0e0; border-top: none;">
                        <h2 style="color: #333; margin-top: 0;">Confirm Account Deletion</h2>
                        <p>You requested to delete your account. Use the code below to verify:</p>
                        <div style="background: white; border: 2px dashed #667eea; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0;">
                            <div style="font-size: 36px; font-weight: bold; color: #667eea; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                                ${otpCode}
                            </div>
                        </div>
                        <p style="color: #666; font-size: 14px;">This code will expire in 10 minutes. If you didn't request this, please secure your account immediately.</p>
                        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">
                        <p style="color: #999; font-size: 12px; margin: 0;">This is an automated email. Please do not reply to this message.</p>
                    </div>
                </body>
                </html>
            `,
            headers: {
                'X-Entity-Ref-ID': `account-delete-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            },
            tags: [
                { name: 'category', value: 'account-deletion' },
                { name: 'type', value: 'otp' }
            ]
        });

        if (error) {
            console.error('Resend API error:', error);
            throw new Error(`Failed to send email: ${error.message}`);
        }
        return data;
    } catch (error) {
        console.error('Email service error:', error);
        throw error;
    }
};

/**
 * Send approver onboarding email with link
 * @param {string} email - Recipient email address
 * @param {string} onboardingLink - Link to complete onboarding
 * @returns {Promise<Object>} - Resend API response
 */
exports.sendApproverOnboardingEmail = async (email, onboardingLink) => {
    try {
        const fromEmail = process.env.RESEND_FROM_EMAIL || 'support@ihirwe.art';
        const appName = process.env.APP_NAME || 'Talynk';
        
        // Plain text version for better deliverability
        const textContent = `
Welcome to ${appName} - Approver Onboarding

You have been invited to become an approver on ${appName}. Please complete your onboarding by clicking the link below:

${onboardingLink}

This link will allow you to:
- Set your password
- Add your first and last name
- Add your contact information (phone number)

If you didn't expect this invitation, please ignore this email.

This is an automated email. Please do not reply to this message.
        `.trim();
        
        const resendClient = getResendClient();
        const { data, error } = await resendClient.emails.send({
            from: fromEmail,
            to: [email],
            replyTo: fromEmail,
            subject: `Complete your ${appName} approver onboarding`,
            text: textContent,
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="utf-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Approver Onboarding</title>
                </head>
                <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                        <h1 style="color: white; margin: 0; font-size: 28px;">${appName}</h1>
                    </div>
                    <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; border: 1px solid #e0e0e0; border-top: none;">
                        <h2 style="color: #333; margin-top: 0;">Welcome! Complete Your Approver Onboarding</h2>
                        <p>You have been invited to become an approver on ${appName}. Please complete your onboarding by clicking the button below:</p>
                        <div style="text-align: center; margin: 30px 0;">
                            <a href="${onboardingLink}" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
                                Complete Onboarding
                            </a>
                        </div>
                        <p style="color: #666; font-size: 14px;">Or copy and paste this link into your browser:</p>
                        <p style="color: #667eea; font-size: 12px; word-break: break-all;">${onboardingLink}</p>
                        <div style="background: white; border-left: 4px solid #667eea; padding: 15px; margin: 20px 0;">
                            <p style="margin: 0; color: #333;"><strong>What you'll need to do:</strong></p>
                            <ul style="margin: 10px 0; padding-left: 20px;">
                                <li>Set your password</li>
                                <li>Add your first and last name</li>
                                <li>Add your contact information (phone number)</li>
                            </ul>
                        </div>
                        <p style="color: #666; font-size: 14px;">If you didn't expect this invitation, please ignore this email.</p>
                        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">
                        <p style="color: #999; font-size: 12px; margin: 0;">This is an automated email. Please do not reply to this message.</p>
                    </div>
                </body>
                </html>
            `,
            headers: {
                'X-Entity-Ref-ID': `approver-onboard-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            },
            tags: [
                { name: 'category', value: 'approver-onboarding' },
                { name: 'type', value: 'invitation' }
            ]
        });

        if (error) {
            console.error('Resend API error:', error);
            throw new Error(`Failed to send email: ${error.message}`);
        }

        return data;
    } catch (error) {
        console.error('Email service error:', error);
        throw error;
    }
};
