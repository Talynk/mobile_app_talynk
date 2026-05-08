const prisma = require('../lib/prisma');
const { validate } = require('uuid');
const { emitEvent } = require('../lib/realtime');

exports.subscribe = async (req, res) => {
    try {
        const subscriberId = req.user.id;
        const { userID: subscribedToId } = req.params;

        console.log(`Attempting subscription: ${subscriberId} -> ${subscribedToId}`);

        // 1. Validate Input
        if (!validate(subscriberId) || !validate(subscribedToId)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid user ID format'
            });
        }

        if (subscriberId === subscribedToId) {
            return res.status(400).json({
                status: 'error',
                message: 'Cannot subscribe to yourself'
            });
        }

        // 2. Check if Target User Exists
        const userToSubscribe = await prisma.user.findUnique({ 
            where: { id: subscribedToId }
        });
        if (!userToSubscribe) {
            return res.status(404).json({
                status: 'error',
                message: 'User to subscribe to not found'
            });
        }
        
        // 3. Check if Subscriber User Exists (important check)
        const subscriberUser = await prisma.user.findUnique({ 
            where: { id: subscriberId }
        });
        if (!subscriberUser) {
            console.error(`Subscriber user with ID ${subscriberId} not found in users table.`);
            // Return a generic error for security, but log the specific issue
            return res.status(401).json({ 
                status: 'error', 
                message: 'Authentication error' 
            }); 
        }

        // 4. Check if subscription already exists
        const existingSubscription = await prisma.subscription.findFirst({
            where: {
                subscriber_id: subscriberId,
                subscribed_to: subscribedToId
            }
        });

        let subscriptionResult;
        let created = false;

        if (!existingSubscription) {
            console.log('Subscription does not exist, creating new one...');
            // 5. Create new subscription
            const creationTime = new Date();
            subscriptionResult = await prisma.subscription.create({
                data: {
                    subscriber_id: subscriberId,
                    subscribed_to: subscribedToId,
                    subscription_date: creationTime
                }
            });
            created = true;
            console.log('Subscription created:', subscriptionResult);

            // 6. Increment subscriber count
            await prisma.user.update({
                where: { id: subscribedToId },
                data: {
                    subscribers: {
                        increment: 1
                    }
                }
            });
            console.log(`Incremented subscriber count for ${subscribedToId}`);

            // 7. Notify user
            const subscribedToUser = await prisma.user.findUnique({
                where: { id: subscribedToId },
                select: { id: true, username: true }
            });
            
            if (subscribedToUser?.username) {
                const notification = await prisma.notification.create({
                    data: {
                        userID: subscribedToUser.username,
                        message: `${req.user.username} subscribed to your channel`,
                        type: 'subscription',
                        isRead: false
                    }
                });
                
                // Emit real-time notification event
                emitEvent('notification:created', {
                    userId: subscribedToUser.id,
                    userID: subscribedToUser.username,
                    notification: {
                        id: notification.id,
                        type: notification.type,
                        message: notification.message,
                        isRead: notification.isRead,
                        createdAt: notification.createdAt
                    }
                });
                
                console.log(`Notification created for ${subscribedToId}`);
            }

        } else {
            console.log('Subscription already exists.');
            subscriptionResult = existingSubscription;
        }

        res.json({
            status: 'success',
            message: created ? 'Subscribed successfully' : 'Already subscribed',
            data: {
                subscription: {
                    subscriber_id: subscriptionResult.subscriber_id,
                    subscribed_to: subscriptionResult.subscribed_to,
                    subscription_date: subscriptionResult.subscription_date
                }
            }
        });

    } catch (error) {
        console.error('Subscription error:', error);
        // Check for specific foreign key constraint error
        if (error.code === 'P2003') {
             console.error('Foreign key constraint violation details:', error);
             return res.status(400).json({
                 status: 'error',
                 message: 'Invalid user ID provided for subscription.' 
             });
        }
        res.status(500).json({
            status: 'error',
            message: 'Error processing subscription',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.unsubscribe = async (req, res) => {
    try {
        const subscriberId = req.user.id;
        const { userId: subscribedToId } = req.params;

        const subscription = await prisma.subscription.findFirst({
            where: {
                subscriber_id: subscriberId,
                subscribed_to: subscribedToId
            }
        });

        if (subscription) {
            await prisma.subscription.delete({
                where: { id: subscription.id }
            });
            
            // Decrement subscriber count
            await prisma.user.update({
                where: { id: subscribedToId },
                data: {
                    subscribers: {
                        decrement: 1
                    }
                }
            });
        }

        res.json({
            status: 'success',
            message: 'Unsubscribed successfully'
        });
    } catch (error) {
        console.error('Unsubscribe error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error processing unsubscribe'
        });
    }
};

exports.getSubscribers = async (req, res) => {
    try {
        const userId = req.user.id;

        const subscribers = await prisma.subscription.findMany({
            where: { subscribed_to: userId },
            include: {
                subscriber: {
                    select: { 
                        username: true, 
                        email: true, 
                        user_facial_image: true 
                    }
                }
            },
            orderBy: { subscription_date: 'desc' }
        });

        res.json({
            status: 'success',
            data: { subscribers }
        });
    } catch (error) {
        console.error('Subscribers fetch error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching subscribers'
        });
    }
}; 