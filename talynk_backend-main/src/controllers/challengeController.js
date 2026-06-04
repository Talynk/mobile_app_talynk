const prisma = require('../lib/prisma');
const path = require('path');
const fs = require('fs').promises;
const { clearCacheByPattern, getUserCache, setUserCache } = require('../utils/cache');
const { emitEvent } = require('../lib/realtime');
const { addVideoJob } = require('../queues/videoQueue');
const { applyFeedReadyFilter } = require('../utils/postFilters');
const { buildUserSearchWhere, normalizeQuery } = require('../utils/userSearch');

/**
 * Snapshot each challenge post's like count at challenge end (for ranking and transparency).
 * Call this when a challenge is ended (e.g. admin stop or cron for end_date).
 * @param {string} challengeId
 */
async function snapshotLikesAtChallengeEnd(challengeId) {
    const challengePosts = await prisma.challengePost.findMany({
        where: { challenge_id: challengeId },
        include: {
            post: {
                select: { id: true, likes: true }
            }
        }
    });
    for (const cp of challengePosts) {
        await prisma.challengePost.update({
            where: { id: cp.id },
            data: { likes_at_challenge_end: cp.post.likes ?? 0 }
        });
    }
}
exports.snapshotLikesAtChallengeEnd = snapshotLikesAtChallengeEnd;

/**
 * Join/submit allowed: not past end_date, and either status is active (live regardless of start_date)
 * or status is approved and now >= start_date.
 * @param {{ status: string, start_date: Date|string, end_date: Date|string }} challenge
 * @param {Date} [now]
 * @returns {boolean}
 */
function isChallengeParticipationOpen(challenge, now = new Date()) {
    if (!challenge) return false;
    const endDate = new Date(challenge.end_date);
    if (Number.isNaN(endDate.getTime()) || now > endDate) return false;
    if (challenge.status === 'active') return true;
    if (challenge.status === 'approved') {
        const startDate = new Date(challenge.start_date);
        if (Number.isNaN(startDate.getTime())) return false;
        return now >= startDate;
    }
    return false;
}

/** Same as participation open for UI "live" badge on lists/detail. */
function isChallengeCurrentlyLive(challenge, now = new Date()) {
    return isChallengeParticipationOpen(challenge, now);
}

exports.isChallengeParticipationOpen = isChallengeParticipationOpen;
exports.isChallengeCurrentlyLive = isChallengeCurrentlyLive;

/**
 * Assign initial winner ranks 1..N to the top N ChallengePosts by likes_at_challenge_end (desc), then submitted_at (desc).
 * N = challenge.max_winners or DEFAULT_MAX_WINNERS (10).
 * Call after snapshotLikesAtChallengeEnd when a challenge becomes ended or stopped.
 * @param {string} challengeId
 */
async function assignInitialWinnerRanks(challengeId) {
    const winnersConfig = await resolveChallengeWinnersConfig(challengeId);
    const cap = winnersConfig?.effective_max_winners ?? 0;
    const top = await prisma.challengePost.findMany({
        where: { challenge_id: challengeId },
        orderBy: [
            { likes_at_challenge_end: 'desc' },
            { submitted_at: 'desc' }
        ],
        select: { id: true },
        take: cap
    });
    await prisma.$transaction(async (tx) => {
        await tx.challengePost.updateMany({
            where: { challenge_id: challengeId },
            data: { winner_rank: null }
        });
        for (let i = 0; i < top.length; i++) {
            await tx.challengePost.update({
                where: { id: top[i].id },
                data: { winner_rank: i + 1 }
            });
        }
    });
}
exports.assignInitialWinnerRanks = assignInitialWinnerRanks;

/** Default max winners when challenge.max_winners is null. */
const DEFAULT_MAX_WINNERS = 10;

/** Default and bounds for max_content_per_account (max posts per participant). */
const DEFAULT_MAX_CONTENT_PER_ACCOUNT = 5;
const MAX_CONTENT_PER_ACCOUNT_LIMIT = 10;

/**
 * @param {{ max_winners?: number | null }} challenge
 * @returns {number}
 */
function getMaxWinners(challenge) {
    return challenge.max_winners != null && challenge.max_winners > 0
        ? challenge.max_winners
        : DEFAULT_MAX_WINNERS;
}

/**
 * @param {{ max_winners?: number | null }} challenge
 * @returns {number}
 */
function getConfiguredMaxWinners(challenge) {
    return getMaxWinners(challenge);
}

/**
 * @param {{ configuredMaxWinners: number, participantCount: number }} params
 * @returns {number}
 */
function getEffectiveMaxWinners({ configuredMaxWinners, participantCount }) {
    const safeParticipants = Math.max(0, parseInt(participantCount, 10) || 0);
    return Math.min(configuredMaxWinners, safeParticipants);
}

/**
 * Resolve winner cap metadata for a challenge.
 * effective_max_winners is capped by participant count.
 * @param {string} challengeId
 * @returns {Promise<{
 *   default_max_winners: number,
 *   configured_max_winners: number,
 *   participant_count: number,
 *   effective_max_winners: number
 * }>}
 */
async function resolveChallengeWinnersConfig(challengeId) {
    const challenge = await prisma.challenge.findUnique({
        where: { id: challengeId },
        select: { id: true, max_winners: true }
    });
    if (!challenge) return null;

    const participantCount = await prisma.challengeParticipant.count({
        where: { challenge_id: challengeId }
    });

    const selectedMaxWinners = challenge.max_winners != null && challenge.max_winners > 0
        ? challenge.max_winners
        : null;
    const configuredMaxWinners = selectedMaxWinners ?? DEFAULT_MAX_WINNERS;
    const defaultAppliedMaxWinners = Math.min(DEFAULT_MAX_WINNERS, participantCount);
    const effectiveMaxWinners = getEffectiveMaxWinners({
        configuredMaxWinners,
        participantCount
    });

    return {
        default_max_winners: DEFAULT_MAX_WINNERS,
        selected_max_winners: selectedMaxWinners,
        default_applied_max_winners: defaultAppliedMaxWinners,
        max_winners_for_clients: selectedMaxWinners ?? defaultAppliedMaxWinners,
        configured_max_winners: configuredMaxWinners,
        participant_count: participantCount,
        effective_max_winners: effectiveMaxWinners
    };
}
exports.resolveChallengeWinnersConfig = resolveChallengeWinnersConfig;

// Create a new challenge request
exports.createChallenge = async (req, res) => {
    try {
        const {
            name,
            description,
            has_rewards,
            rewards,
            organizer_name,
            organizer_contact,
            contact_email,
            start_date,
            end_date,
            min_content_per_account,
            max_content_per_account,
            scoring_criteria,
            eligibility_criteria,
            what_you_do
        } = req.body;

        const userId = req.user.id;
        const userRole = req.user.role;

        // Only regular users can create challenges, not admins or approvers
        if (userRole === 'admin' || userRole === 'approver') {
            return res.status(403).json({
                status: 'error',
                message: 'Admins and approvers cannot create challenges. Only regular users can organize challenges.'
            });
        }

        // Verify that the user exists in the users table
        const user = await prisma.user.findUnique({
            where: { id: userId }
        });

        if (!user) {
            return res.status(404).json({
                status: 'error',
                message: 'User not found'
            });
        }

        // Validate required fields
        if (!name || !organizer_name || !organizer_contact || !contact_email || !start_date || !end_date) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required fields: name, organizer_name, organizer_contact, contact_email, start_date, end_date'
            });
        }

        // Validate contact email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(contact_email.trim())) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid contact email format'
            });
        }

        // Validate dates
        const startDate = new Date(start_date);
        const endDate = new Date(end_date);
        const now = new Date();

        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid date format'
            });
        }

        if (startDate < now) {
            return res.status(400).json({
                status: 'error',
                message: 'Start date must be in the future'
            });
        }

        if (endDate <= startDate) {
            return res.status(400).json({
                status: 'error',
                message: 'End date must be after start date'
            });
        }

        // Validate rewards if has_rewards is true
        if (has_rewards && !rewards) {
            return res.status(400).json({
                status: 'error',
                message: 'Rewards description is required when has_rewards is true'
            });
        }

        const parsedMaxContent = max_content_per_account != null
            ? parseInt(max_content_per_account, 10)
            : DEFAULT_MAX_CONTENT_PER_ACCOUNT;
        if (Number.isNaN(parsedMaxContent) || parsedMaxContent < 1 || parsedMaxContent > MAX_CONTENT_PER_ACCOUNT_LIMIT) {
            return res.status(400).json({
                status: 'error',
                message: `max_content_per_account must be an integer between 1 and ${MAX_CONTENT_PER_ACCOUNT_LIMIT}`,
                code: 'INVALID_MAX_CONTENT_PER_ACCOUNT'
            });
        }

        // Create challenge with pending status
        const challenge = await prisma.challenge.create({
            data: {
                name: name.trim(),
                description: description?.trim() || null,
                has_rewards: has_rewards || false,
                rewards: has_rewards ? rewards.trim() : null,
                organizer_id: userId,
                organizer_name: organizer_name.trim(),
                organizer_contact: organizer_contact.trim(),
                contact_email: contact_email.trim().toLowerCase(),
                start_date: startDate,
                end_date: endDate,
                min_content_per_account: min_content_per_account || 1,
                max_content_per_account: parsedMaxContent,
                scoring_criteria: scoring_criteria?.trim() || null,
                eligibility_criteria: eligibility_criteria?.trim() || null,
                what_you_do: what_you_do?.trim() || null,
                status: 'pending'
            },
            include: {
                organizer: {
                    select: {
                        id: true,
                        username: true,
                        email: true
                    }
                }
            }
        });

        res.status(201).json({
            status: 'success',
            message: 'Challenge request submitted successfully. Waiting for admin approval.',
            data: challenge
        });
    } catch (error) {
        console.error('Error creating challenge:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to create challenge',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Edit a challenge (only while pending, organizer only)
exports.updateChallenge = async (req, res) => {
    try {
        const { challengeId } = req.params;
        const userId = req.user.id;
        const {
            name,
            description,
            has_rewards,
            rewards,
            organizer_name,
            organizer_contact,
            contact_email,
            start_date,
            end_date,
            min_content_per_account,
            max_content_per_account,
            scoring_criteria,
            eligibility_criteria,
            what_you_do
        } = req.body;

        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(challengeId)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid challenge ID format.'
            });
        }

        const challenge = await prisma.challenge.findUnique({
            where: { id: challengeId },
            include: {
                organizer: {
                    select: {
                        id: true,
                        username: true,
                        email: true
                    }
                }
            }
        });

        if (!challenge) {
            return res.status(404).json({
                status: 'error',
                message: 'Challenge not found'
            });
        }

        if (challenge.organizer_id !== userId) {
            return res.status(403).json({
                status: 'error',
                message: 'Only the organizer can edit this challenge'
            });
        }

        if (challenge.status !== 'pending') {
            return res.status(400).json({
                status: 'error',
                message: 'Only pending challenges can be edited. Once the challenge is under review or has been approved/rejected, edits are not allowed.'
            });
        }

        // Build update object with only provided fields
        const updateData = {};

        if (name !== undefined) updateData.name = name.trim();
        if (description !== undefined) updateData.description = description?.trim() || null;
        if (has_rewards !== undefined) updateData.has_rewards = !!has_rewards;
        if (has_rewards && rewards !== undefined) updateData.rewards = rewards.trim();
        else if (has_rewards === false) updateData.rewards = null;
        if (organizer_name !== undefined) updateData.organizer_name = organizer_name.trim();
        if (organizer_contact !== undefined) updateData.organizer_contact = organizer_contact.trim();
        if (contact_email !== undefined) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(contact_email.trim())) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Invalid contact email format'
                });
            }
            updateData.contact_email = contact_email.trim().toLowerCase();
        }
        if (min_content_per_account !== undefined) updateData.min_content_per_account = min_content_per_account;
        if (max_content_per_account !== undefined) {
            const parsedMax = parseInt(max_content_per_account, 10);
            if (Number.isNaN(parsedMax) || parsedMax < 1 || parsedMax > MAX_CONTENT_PER_ACCOUNT_LIMIT) {
                return res.status(400).json({
                    status: 'error',
                    message: `max_content_per_account must be an integer between 1 and ${MAX_CONTENT_PER_ACCOUNT_LIMIT}`,
                    code: 'INVALID_MAX_CONTENT_PER_ACCOUNT'
                });
            }
            updateData.max_content_per_account = parsedMax;
        }
        if (scoring_criteria !== undefined) updateData.scoring_criteria = scoring_criteria?.trim() || null;
        if (eligibility_criteria !== undefined) updateData.eligibility_criteria = eligibility_criteria?.trim() || null;
        if (what_you_do !== undefined) updateData.what_you_do = what_you_do?.trim() || null;

        if (start_date !== undefined || end_date !== undefined) {
            const startDate = start_date ? new Date(start_date) : new Date(challenge.start_date);
            const endDate = end_date ? new Date(end_date) : new Date(challenge.end_date);
            const now = new Date();

            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Invalid date format'
                });
            }
            if (startDate < now) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Start date must be in the future'
                });
            }
            if (endDate <= startDate) {
                return res.status(400).json({
                    status: 'error',
                    message: 'End date must be after start date'
                });
            }
            if (start_date !== undefined) updateData.start_date = startDate;
            if (end_date !== undefined) updateData.end_date = endDate;
        }

        if (updateData.has_rewards && (updateData.rewards === undefined && !challenge.rewards)) {
            return res.status(400).json({
                status: 'error',
                message: 'Rewards description is required when has_rewards is true'
            });
        }

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'No valid fields to update'
            });
        }

        const updated = await prisma.challenge.update({
            where: { id: challengeId },
            data: updateData,
            include: {
                organizer: {
                    select: {
                        id: true,
                        username: true,
                        email: true
                    }
                }
            }
        });

        res.json({
            status: 'success',
            message: 'Challenge updated successfully. Waiting for admin approval.',
            data: updated
        });
    } catch (error) {
        console.error('Error updating challenge:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to update challenge',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get all approved and active challenges (public endpoint)
// Pending challenges are never returned in public endpoints
exports.getAllChallenges = async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Only allow approved, active, ended, or stopped status - never pending or rejected
        const allowedStatuses = ['approved', 'active', 'ended', 'stopped'];
        let statusFilter = ['approved', 'active']; // Default to approved/active

        if (status) {
            // Only use the status if it's in the allowed list (exclude pending/rejected)
            if (allowedStatuses.includes(status)) {
                statusFilter = [status];
            }
        }

        const where = {
            status: {
                in: statusFilter
            }
        };

        const [challenges, total] = await Promise.all([
            prisma.challenge.findMany({
                where,
                skip,
                take: parseInt(limit),
                orderBy: {
                    createdAt: 'desc'
                },
                include: {
                    organizer: {
                        select: {
                            id: true,
                            username: true,
                            display_name: true,
                            profile_picture: true
                        }
                    },
                    _count: {
                        select: {
                            participants: true,
                            posts: true
                        }
                    }
                }
            }),
            prisma.challenge.count({ where })
        ]);

        const now = new Date();
        const challengesWithStatus = challenges.map(challenge => ({
            ...challenge,
            is_currently_active: isChallengeCurrentlyLive(challenge, now)
        }));

        res.json({
            status: 'success',
            data: challengesWithStatus,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Error fetching challenges:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch challenges',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get active challenges (public endpoint)
exports.getActiveChallenges = async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const now = new Date();

        const activeWhere = {
            status: { in: ['approved', 'active'] },
            end_date: { gte: now },
            OR: [
                { status: 'active' },
                { status: 'approved', start_date: { lte: now } }
            ]
        };

        const [challenges, total] = await Promise.all([
            prisma.challenge.findMany({
                where: activeWhere,
                skip,
                take: parseInt(limit),
                orderBy: {
                    createdAt: 'desc'
                },
                include: {
                    organizer: {
                        select: {
                            id: true,
                            username: true,
                            display_name: true,
                            profile_picture: true
                        }
                    },
                    _count: {
                        select: {
                            participants: true,
                            posts: true
                        }
                    }
                }
            }),
            prisma.challenge.count({ where: activeWhere })
        ]);

        const challengesWithStatus = challenges.map(challenge => ({
            ...challenge,
            is_currently_active: isChallengeCurrentlyLive(challenge, now)
        }));

        res.json({
            status: 'success',
            data: challengesWithStatus,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Error fetching active challenges:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch active challenges',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get ended challenges (public endpoint)
exports.getEndedChallenges = async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const now = new Date();

        const [challenges, total] = await Promise.all([
            prisma.challenge.findMany({
                where: {
                    OR: [
                        {
                            status: {
                                in: ['ended', 'stopped']
                            }
                        },
                        {
                            status: {
                                in: ['approved', 'active']
                            },
                            end_date: {
                                lt: now
                            }
                        }
                    ]
                },
                skip,
                take: parseInt(limit),
                orderBy: {
                    end_date: 'desc'
                },
                include: {
                    organizer: {
                        select: {
                            id: true,
                            username: true,
                            display_name: true,
                            profile_picture: true
                        }
                    },
                    _count: {
                        select: {
                            participants: true,
                            posts: true
                        }
                    }
                }
            }),
            prisma.challenge.count({
                where: {
                    OR: [
                        {
                            status: {
                                in: ['ended', 'stopped']
                            }
                        },
                        {
                            status: {
                                in: ['approved', 'active']
                            },
                            end_date: {
                                lt: now
                            }
                        }
                    ]
                }
            })
        ]);

        const challengesWithStatus = challenges.map(challenge => ({
            ...challenge,
            is_currently_active: false
        }));

        res.json({
            status: 'success',
            data: challengesWithStatus,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error fetching ended challenges:`, error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch ended challenges',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get a single challenge by ID (public endpoint)
// Pending and rejected challenges are not accessible to unauthenticated users
exports.getChallengeById = async (req, res) => {
    try {
        const { challengeId } = req.params;
        const userId = req.user?.id;

        // Validate challengeId is a valid UUID to avoid Prisma P2023 errors
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(challengeId)) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid challenge ID format.'
            });
        }

        const challenge = await prisma.challenge.findUnique({
            where: { id: challengeId },
            include: {
                organizer: {
                    select: {
                        id: true,
                        username: true,
                        display_name: true,
                        profile_picture: true
                    }
                },
                _count: {
                    select: {
                        participants: true,
                        posts: true
                    }
                }
            }
        });

        if (!challenge) {
            return res.status(404).json({
                status: 'error',
                message: 'Challenge not found'
            });
        }

        // Hide pending and rejected challenges from public view
        // Only authenticated users who are organizers can see their own pending challenges
        if (challenge.status === 'pending' || challenge.status === 'rejected') {
            // Allow organizer to see their own pending/rejected challenges
            if (!userId || challenge.organizer_id !== userId) {
                return res.status(404).json({
                    status: 'error',
                    message: 'Challenge not found'
                });
            }
        }

        // Check if user is a participant
        let isParticipant = false;
        if (userId) {
            const participant = await prisma.challengeParticipant.findUnique({
                where: {
                    unique_challenge_participant: {
                        challenge_id: challengeId,
                        user_id: userId
                    }
                }
            });
            isParticipant = !!participant;
        }

        const now = new Date();
        const isActive = isChallengeCurrentlyLive(challenge, now);
        const winnersConfig = await resolveChallengeWinnersConfig(challengeId);

        res.json({
            status: 'success',
            data: {
                ...challenge,
                is_currently_active: isActive,
                is_participant: isParticipant,
                max_winners: winnersConfig?.max_winners_for_clients ?? 0
            }
        });
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error fetching challenge:`, error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch challenge',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Join a challenge
exports.joinChallenge = async (req, res) => {
    try {
        const { challengeId } = req.params;
        const userId = req.user.id;

        // Check if challenge exists
        const challenge = await prisma.challenge.findUnique({
            where: { id: challengeId }
        });

        if (!challenge) {
            return res.status(404).json({
                status: 'error',
                message: 'Challenge not found'
            });
        }

        // Check if challenge is approved
        if (challenge.status !== 'approved' && challenge.status !== 'active') {
            return res.status(400).json({
                status: 'error',
                message: 'Challenge is not available for participation'
            });
        }

        // Check if user is the organizer
        if (challenge.organizer_id === userId) {
            return res.status(400).json({
                status: 'error',
                message: 'Organizer cannot join their own challenge'
            });
        }

        const now = new Date();
        const endDate = new Date(challenge.end_date);
        if (now > endDate) {
            return res.status(400).json({
                status: 'error',
                message: 'Challenge has ended'
            });
        }
        if (!isChallengeParticipationOpen(challenge, now)) {
            return res.status(400).json({
                status: 'error',
                message: 'Challenge has not started yet'
            });
        }

        // Check if already a participant
        const existingParticipant = await prisma.challengeParticipant.findUnique({
            where: {
                unique_challenge_participant: {
                    challenge_id: challengeId,
                    user_id: userId
                }
            }
        });

        if (existingParticipant) {
            return res.status(400).json({
                status: 'error',
                message: 'You are already a participant in this challenge'
            });
        }

        // Add user as participant
        const participant = await prisma.challengeParticipant.create({
            data: {
                challenge_id: challengeId,
                user_id: userId
            },
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        display_name: true,
                        profile_picture: true
                    }
                },
                challenge: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            }
        });

        res.status(201).json({
            status: 'success',
            message: 'Successfully joined the challenge',
            data: participant
        });
    } catch (error) {
        console.error('Error joining challenge:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to join challenge',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get participants of a challenge (public endpoint - accessible to unauthenticated users)
exports.getChallengeParticipants = async (req, res) => {
    try {
        const { challengeId } = req.params;
        const userId = req.user?.id; // Optional - user might not be authenticated
        const { page = 1, limit = 50 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Check if challenge exists
        const challenge = await prisma.challenge.findUnique({
            where: { id: challengeId },
            select: {
                id: true,
                organizer_id: true,
                status: true
            }
        });

        if (!challenge) {
            return res.status(404).json({
                status: 'error',
                message: 'Challenge not found'
            });
        }

        // Hide pending and rejected challenges from public view
        // Only authenticated users who are organizers can see their own pending challenges
        if (challenge.status === 'pending' || challenge.status === 'rejected') {
            // Allow organizer to see their own pending/rejected challenges
            if (!userId || challenge.organizer_id !== userId) {
                return res.status(404).json({
                    status: 'error',
                    message: 'Challenge not found'
                });
            }
        }

        const [participants, total] = await Promise.all([
            prisma.challengeParticipant.findMany({
                where: { challenge_id: challengeId },
                skip,
                take: parseInt(limit),
                orderBy: {
                    joined_at: 'desc'
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            username: true,
                            display_name: true,
                            profile_picture: true,
                            posts_count: true,
                            follower_count: true
                        }
                    }
                }
            }),
            prisma.challengeParticipant.count({
                where: { challenge_id: challengeId }
            })
        ]);

        // Get post counts for each participant
        const participantsWithPostCounts = await Promise.all(
            participants.map(async (participant) => {
                const postCount = await prisma.challengePost.count({
                    where: {
                        challenge_id: challengeId,
                        user_id: participant.user_id
                    }
                });

                return {
                    ...participant,
                    post_count: postCount
                };
            })
        );

        res.json({
            status: 'success',
            data: participantsWithPostCounts,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Error fetching participants:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch participants',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get posts for a challenge (public endpoint - accessible to unauthenticated users)
// For ended challenges: orders by likes at challenge end (authenticity/transparency) and returns both
// likes_at_challenge_end and current total likes per post.
exports.getChallengePosts = async (req, res) => {
    try {
        const { challengeId } = req.params;
        const { page = 1, limit = 20 } = req.query;
        const pageNumber = parseInt(page);
        const pageLimit = parseInt(limit);
        const skip = (pageNumber - 1) * pageLimit;

        // Check if challenge exists
        let challenge = await prisma.challenge.findUnique({
            where: { id: challengeId }
        });

        if (!challenge) {
            return res.status(404).json({
                status: 'error',
                message: 'Challenge not found'
            });
        }

        // Only return posts from active/approved/ended/stopped challenges (not pending or rejected)
        if (challenge.status === 'pending' || challenge.status === 'rejected') {
            return res.status(404).json({
                status: 'error',
                message: 'Challenge not found'
            });
        }

        const now = new Date();
        const endDate = new Date(challenge.end_date);
        const isOverStatus = challenge.status === 'ended' || challenge.status === 'stopped';
        const isEnded = isOverStatus || endDate < now;

        // If challenge ended by date but status wasn't updated, mark ended and snapshot likes once
        if (!isOverStatus && endDate < now) {
            await prisma.challenge.update({
                where: { id: challengeId },
                data: { status: 'ended' }
            });
            await snapshotLikesAtChallengeEnd(challengeId);
            await assignInitialWinnerRanks(challengeId);
            challenge = await prisma.challenge.findUnique({ where: { id: challengeId } });
        }

        const winnersConfirmedAt = challenge.winners_confirmed_at;
        const winnersVisible = !!(isEnded && winnersConfirmedAt);

        // If challenge is over but winners are not yet confirmed, hide winners from public/mobile.
        if (isEnded && !winnersVisible) {
            return res.json({
                status: 'success',
                data: [],
                pagination: {
                    page: pageNumber,
                    limit: pageLimit,
                    total: 0,
                    pages: 0
                },
                winners_visible: false,
                winners_confirmed_at: null,
                challenge_status: challenge.status
            });
        }

        // For ended/stopped challenges with confirmed winners: order by winner_rank (asc; nulls last), then likes at challenge end (desc), then submitted_at.
        // For active/approved challenges: order by submitted_at.
        const orderBy = isEnded
            ? [
                { winner_rank: 'asc' },
                { likes_at_challenge_end: 'desc' },
                { submitted_at: 'desc' }
            ]
            : { submitted_at: 'desc' };

        const [challengePosts, total] = await Promise.all([
            prisma.challengePost.findMany({
                where: {
                    challenge_id: challengeId,
                    post: applyFeedReadyFilter({})
                },
                skip,
                take: pageLimit,
                orderBy,
                include: {
                    post: {
                        include: {
                            user: {
                                select: {
                                    id: true,
                                    username: true,
                                    display_name: true,
                                    profile_picture: true
                                }
                            },
                            category: {
                                select: {
                                    id: true,
                                    name: true
                                }
                            },
                            _count: {
                                select: {
                                    postLikes: true,
                                    comments: true,
                                    postViews: true
                                }
                            }
                        }
                    },
                    user: {
                        select: {
                            id: true,
                            username: true,
                            display_name: true,
                            profile_picture: true
                        }
                    }
                }
            }),
            prisma.challengePost.count({
                where: {
                    challenge_id: challengeId,
                    post: applyFeedReadyFilter({})
                }
            })
        ]);

        // Enrich each item with explicit like counts and winner_rank for transparency (during challenge vs total)
        const hasWinnerRanks = isEnded && challengePosts.some(cp => cp.winner_rank != null);
        const data = challengePosts.map(cp => ({
            ...cp,
            likes_during_challenge: cp.likes_at_challenge_end ?? null,
            total_likes: cp.post?.likes ?? cp.post?._count?.postLikes ?? 0,
            winner_rank: cp.winner_rank ?? null
        }));

        res.json({
            status: 'success',
            data,
            pagination: {
                page: pageNumber,
                limit: pageLimit,
                total,
                pages: Math.ceil(total / pageLimit)
            },
            winners_visible: winnersVisible,
            winners_confirmed_at: winnersConfirmedAt,
            ...(isEnded && { ordered_by: hasWinnerRanks ? 'winner_rank' : 'likes_at_challenge_end' })
        });
    } catch (error) {
        console.error('Error fetching challenge posts:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch challenge posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Aggregated winners per user (public/mobile). One row per user, only visible after winners are confirmed.
exports.getAggregatedChallengeWinners = async (req, res) => {
    try {
        const { challengeId } = req.params;
        const { page = 1, limit = 10 } = req.query;
        const pageNumber = parseInt(page);
        const pageLimit = parseInt(limit);
        const offset = (pageNumber - 1) * pageLimit;

        const challenge = await prisma.challenge.findUnique({
            where: { id: challengeId }
        });

        if (!challenge) {
            return res.status(404).json({
                status: 'error',
                message: 'Challenge not found'
            });
        }

        if (challenge.status === 'pending' || challenge.status === 'rejected') {
            return res.status(404).json({
                status: 'error',
                message: 'Challenge not found'
            });
        }

        const now = new Date();
        const endDate = new Date(challenge.end_date);
        const isOverStatus = challenge.status === 'ended' || challenge.status === 'stopped';
        const isEnded = isOverStatus || endDate < now;
        const winnersConfirmedAt = challenge.winners_confirmed_at;
        const winnersVisible = !!(isEnded && winnersConfirmedAt);
        const winnersConfig = await resolveChallengeWinnersConfig(challengeId);

        // If winners are not yet confirmed, expose metadata but no winners.
        if (!winnersVisible) {
            return res.json({
                status: 'success',
                data: [],
                pagination: {
                    page: pageNumber,
                    limit: pageLimit,
                    total: 0,
                    pages: 0
                },
                winners_visible: false,
                winners_confirmed_at: null,
                challenge_status: challenge.status,
                max_winners: winnersConfig?.max_winners_for_clients ?? 0
            });
        }

        const challengePosts = await prisma.challengePost.findMany({
            where: { challenge_id: challengeId },
            orderBy: [
                { winner_rank: 'asc' },
                { likes_at_challenge_end: 'desc' },
                { submitted_at: 'desc' }
            ],
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        display_name: true,
                        profile_picture: true
                    }
                },
                post: {
                    select: {
                        id: true,
                        likes: true,
                        createdAt: true,
                        video_url: true,
                        hls_url: true,
                        thumbnail_url: true,
                        type: true,
                        title: true,
                        description: true
                    }
                }
            }
        });

        // Aggregate per user
        const byUser = new Map();
        for (const cp of challengePosts) {
            const key = cp.user_id;
            if (!byUser.has(key)) {
                byUser.set(key, {
                    user_id: cp.user_id,
                    user: cp.user,
                    total_winner_posts: 0,
                    total_likes_during_challenge: 0,
                    winner_rank: cp.winner_rank ?? null,
                    latest_submission_at: cp.submitted_at,
                    posts: []
                });
            }
            const agg = byUser.get(key);
            agg.total_winner_posts += 1;
            const likesDuring = cp.likes_at_challenge_end ?? 0;
            agg.total_likes_during_challenge += likesDuring;
            if (cp.winner_rank != null) {
                if (agg.winner_rank == null || cp.winner_rank < agg.winner_rank) {
                    agg.winner_rank = cp.winner_rank;
                }
            }
            if (new Date(cp.submitted_at) > new Date(agg.latest_submission_at)) {
                agg.latest_submission_at = cp.submitted_at;
            }
            agg.posts.push({
                challenge_post_id: cp.id,
                post_id: cp.post?.id,
                likes_during_challenge: likesDuring,
                total_likes: cp.post?.likes ?? 0,
                winner_rank: cp.winner_rank ?? null,
                submitted_at: cp.submitted_at
            });
        }

        let aggregated = Array.from(byUser.values());

        // Sort: when admin has set winner_rank on posts, use min winner_rank per user (asc, nulls last). Otherwise default to total likes per user (desc). Tie-break: total likes, then latest submission.
        const hasAdminRank = aggregated.some(a => a.winner_rank != null);
        aggregated.sort((a, b) => {
            if (hasAdminRank) {
                const rankA = a.winner_rank ?? Infinity;
                const rankB = b.winner_rank ?? Infinity;
                if (rankA !== rankB) return rankA - rankB;
            }
            if (b.total_likes_during_challenge !== a.total_likes_during_challenge) {
                return b.total_likes_during_challenge - a.total_likes_during_challenge;
            }
            return new Date(b.latest_submission_at) - new Date(a.latest_submission_at);
        });

        // Apply max_winners cap (default 10); only top N are "winners"
        const maxWinners = winnersConfig?.effective_max_winners ?? 0;
        const maxWinnersForClients = winnersConfig?.max_winners_for_clients ?? 0;
        const winnersSlice = aggregated.slice(0, maxWinners);
        aggregated.forEach((a, i) => {
            a.is_winner = i < maxWinners;
        });
        const total = aggregated.length;
        const pageItems = aggregated.slice(offset, offset + pageLimit);

        res.json({
            status: 'success',
            data: pageItems,
            pagination: {
                page: pageNumber,
                limit: pageLimit,
                total,
                pages: Math.ceil(total / pageLimit)
            },
            winners_visible: true,
            winners_confirmed_at: winnersConfirmedAt,
            ordered_by: hasAdminRank ? 'admin_rank' : 'total_likes_per_user',
            max_winners: maxWinnersForClients,
            winners: winnersSlice
        });
    } catch (error) {
        console.error('Error fetching aggregated challenge winners:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch aggregated challenge winners',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get all posts a given user (participant) submitted to a challenge. Works for any participant, before or after winners confirmation.
exports.getChallengeParticipantPosts = async (req, res) => {
    try {
        const { challengeId, userId } = req.params;

        const challenge = await prisma.challenge.findUnique({
            where: { id: challengeId },
            select: {
                id: true,
                status: true,
                winners_confirmed_at: true
            }
        });

        if (!challenge) {
            return res.status(404).json({
                status: 'error',
                message: 'Challenge not found'
            });
        }

        if (challenge.status === 'pending' || challenge.status === 'rejected') {
            return res.status(404).json({
                status: 'error',
                message: 'Challenge not found'
            });
        }

        const challengePosts = await prisma.challengePost.findMany({
            where: {
                challenge_id: challengeId,
                user_id: userId
            },
            orderBy: [
                { winner_rank: 'asc' },
                { likes_at_challenge_end: 'desc' },
                { submitted_at: 'desc' }
            ],
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        display_name: true,
                        profile_picture: true
                    }
                },
                post: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                username: true,
                                display_name: true,
                                profile_picture: true
                            }
                        },
                        category: {
                            select: {
                                id: true,
                                name: true
                            }
                        },
                        _count: {
                            select: {
                                postLikes: true,
                                comments: true,
                                postViews: true
                            }
                        }
                    }
                }
            }
        });

        const data = challengePosts.map(cp => ({
            ...cp,
            likes_during_challenge: cp.likes_at_challenge_end ?? null,
            total_likes: cp.post?.likes ?? cp.post?._count?.postLikes ?? 0,
            winner_rank: cp.winner_rank ?? null
        }));

        const winnersVisible = !!(challenge.winners_confirmed_at);

        res.json({
            status: 'success',
            data,
            winners_visible: winnersVisible,
            winners_confirmed_at: challenge.winners_confirmed_at
        });
    } catch (error) {
        console.error('Error fetching challenge participant posts:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch participant posts',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Drill-down: get all posts for a specific winner (user) in a challenge. Only when winners are confirmed.
exports.getChallengeWinnerUserPosts = async (req, res) => {
    try {
        const { challengeId, userId } = req.params;

        const challenge = await prisma.challenge.findUnique({
            where: { id: challengeId },
            select: {
                id: true,
                status: true,
                winners_confirmed_at: true
            }
        });

        if (!challenge) {
            return res.status(404).json({
                status: 'error',
                message: 'Challenge not found'
            });
        }

        if (challenge.status === 'pending' || challenge.status === 'rejected') {
            return res.status(404).json({
                status: 'error',
                message: 'Challenge not found'
            });
        }

        const now = new Date();
        const isOverStatus = challenge.status === 'ended' || challenge.status === 'stopped';
        const isEnded = isOverStatus || challenge.winners_confirmed_at != null || now > new Date();
        const winnersVisible = !!(isEnded && challenge.winners_confirmed_at);

        if (!winnersVisible) {
            return res.status(403).json({
                status: 'error',
                message: 'Winners have not been announced yet'
            });
        }

        const challengePosts = await prisma.challengePost.findMany({
            where: {
                challenge_id: challengeId,
                user_id: userId
            },
            orderBy: [
                { winner_rank: 'asc' },
                { likes_at_challenge_end: 'desc' },
                { submitted_at: 'desc' }
            ],
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        display_name: true,
                        profile_picture: true
                    }
                },
                post: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                username: true,
                                display_name: true,
                                profile_picture: true
                            }
                        },
                        category: {
                            select: {
                                id: true,
                                name: true
                            }
                        },
                        _count: {
                            select: {
                                postLikes: true,
                                comments: true,
                                postViews: true
                            }
                        }
                    }
                }
            }
        });

        const data = challengePosts.map(cp => ({
            ...cp,
            likes_during_challenge: cp.likes_at_challenge_end ?? null,
            total_likes: cp.post?.likes ?? cp.post?._count?.postLikes ?? 0,
            winner_rank: cp.winner_rank ?? null
        }));

        res.json({
            status: 'success',
            data,
            winners_visible: true,
            winners_confirmed_at: challenge.winners_confirmed_at
        });
    } catch (error) {
        console.error('Error fetching challenge winner user posts:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch winner posts for user',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Participants ranking by total likes across their posts in the challenge.
exports.getChallengeParticipantsRanking = async (req, res) => {
    try {
        const { challengeId } = req.params;
        const { page = 1, limit = 10, search } = req.query;
        const pageNumber = parseInt(page);
        const pageLimit = parseInt(limit);
        const offset = (pageNumber - 1) * pageLimit;

        const challenge = await prisma.challenge.findUnique({
            where: { id: challengeId },
            select: {
                id: true,
                status: true,
                end_date: true,
                winners_confirmed_at: true,
                max_winners: true
            }
        });

        if (!challenge) {
            return res.status(404).json({
                status: 'error',
                message: 'Challenge not found'
            });
        }

        if (challenge.status === 'pending' || challenge.status === 'rejected') {
            return res.status(404).json({
                status: 'error',
                message: 'Challenge not found'
            });
        }

        const searchNorm = normalizeQuery(search);
        const cacheKeyBase = `challenge_participants_ranking:${challengeId}`;
        const cacheKey = searchNorm
            ? `${cacheKeyBase}:search:${searchNorm.toLowerCase()}`
            : cacheKeyBase;

        // Short-lived cache for rankings
        const cached = await getUserCache(cacheKey);
        if (cached) {
            return res.json({
                status: 'success',
                ...cached,
                cached: true
            });
        }

        const participantWhere = { challenge_id: challengeId };
        if (searchNorm) {
            const userWhere = buildUserSearchWhere(searchNorm);
            if (Object.keys(userWhere).length > 0) {
                participantWhere.user = userWhere;
            }
        }

        const participants = await prisma.challengeParticipant.findMany({
            where: participantWhere,
            include: {
                user: {
                    select: {
                        id: true,
                        username: true,
                        display_name: true,
                        profile_picture: true,
                        follower_count: true,
                        posts_count: true
                    }
                }
            }
        });

        const challengePosts = await prisma.challengePost.findMany({
            where: { challenge_id: challengeId },
            include: {
                post: {
                    select: {
                        id: true,
                        likes: true,
                        createdAt: true
                    }
                }
            }
        });

        const isOverStatus = challenge.status === 'ended' || challenge.status === 'stopped';
        const now = new Date();
        const isEndedByTime = new Date(challenge.end_date) < now;
        const isEnded = isOverStatus || isEndedByTime;

        const participantCount = participants.length;
        const selectedMaxWinners = challenge.max_winners != null && challenge.max_winners > 0
            ? challenge.max_winners
            : null;
        const configuredMaxWinners = selectedMaxWinners ?? DEFAULT_MAX_WINNERS;
        const maxWinners = getEffectiveMaxWinners({
            configuredMaxWinners,
            participantCount
        });
        const maxWinnersForClients = selectedMaxWinners ?? Math.min(DEFAULT_MAX_WINNERS, participantCount);
        const statsByUser = new Map();
        for (const cp of challengePosts) {
            const key = cp.user_id;
            if (!statsByUser.has(key)) {
                statsByUser.set(key, {
                    user_id: cp.user_id,
                    total_posts: 0,
                    total_likes: 0,
                    latest_submission_at: cp.submitted_at,
                    winner_rank: null
                });
            }
            const agg = statsByUser.get(key);
            agg.total_posts += 1;
            const likesSource = isEnded && cp.likes_at_challenge_end != null
                ? cp.likes_at_challenge_end
                : (cp.post?.likes ?? 0);
            agg.total_likes += likesSource;
            if (new Date(cp.submitted_at) > new Date(agg.latest_submission_at)) {
                agg.latest_submission_at = cp.submitted_at;
            }
            if (cp.winner_rank != null) {
                if (agg.winner_rank == null || cp.winner_rank < agg.winner_rank) {
                    agg.winner_rank = cp.winner_rank;
                }
            }
        }

        let rows = participants.map(p => {
            const stats = statsByUser.get(p.user_id) || {
                user_id: p.user_id,
                total_posts: 0,
                total_likes: 0,
                latest_submission_at: p.joined_at,
                winner_rank: null
            };
            return {
                user_id: p.user_id,
                user: p.user,
                total_posts: stats.total_posts,
                total_likes: stats.total_likes,
                latest_submission_at: stats.latest_submission_at,
                winner_rank: stats.winner_rank
            };
        });

        // Sort: winners first (by winner_rank asc, nulls last), then by total_likes desc, then latest_submission
        rows.sort((a, b) => {
            const rankA = a.winner_rank ?? Infinity;
            const rankB = b.winner_rank ?? Infinity;
            if (rankA !== rankB) return rankA - rankB;
            if (b.total_likes !== a.total_likes) return b.total_likes - a.total_likes;
            return new Date(b.latest_submission_at) - new Date(a.latest_submission_at);
        });

        rows.forEach((r, i) => {
            r.is_winner = i < maxWinners && r.winner_rank != null;
        });

        const total = rows.length;
        const pageItems = rows.slice(offset, offset + pageLimit);

        const responsePayload = {
            data: pageItems,
            pagination: {
                page: pageNumber,
                limit: pageLimit,
                total,
                pages: Math.ceil(total / pageLimit)
            },
            max_winners: maxWinnersForClients
        };

        // Cache briefly (e.g. 15 seconds) to smooth bursts
        await setUserCache(cacheKey, responsePayload, 15);

        res.json({
            status: 'success',
            ...responsePayload
        });
    } catch (error) {
        console.error('Error fetching challenge participants ranking:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch challenge participants ranking',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get challenges organized by the current user
exports.getMyChallenges = async (req, res) => {
    try {
        const userId = req.user.id;
        const { status, page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const where = {
            organizer_id: userId,
            ...(status && { status })
        };

        const [challenges, total] = await Promise.all([
            prisma.challenge.findMany({
                where,
                skip,
                take: parseInt(limit),
                orderBy: {
                    createdAt: 'desc'
                },
                include: {
                    _count: {
                        select: {
                            participants: true,
                            posts: true
                        }
                    }
                }
            }),
            prisma.challenge.count({ where })
        ]);

        res.json({
            status: 'success',
            data: challenges,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Error fetching my challenges:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch challenges',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get challenges the user has joined
exports.getJoinedChallenges = async (req, res) => {
    try {
        const userId = req.user.id;
        const { page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [participations, total] = await Promise.all([
            prisma.challengeParticipant.findMany({
                where: { user_id: userId },
                skip,
                take: parseInt(limit),
                orderBy: {
                    joined_at: 'desc'
                },
                include: {
                    challenge: {
                        include: {
                            organizer: {
                                select: {
                                    id: true,
                                    username: true,
                                    display_name: true,
                                    profile_picture: true
                                }
                            },
                            _count: {
                                select: {
                                    participants: true,
                                    posts: true
                                }
                            }
                        }
                    }
                }
            }),
            prisma.challengeParticipant.count({
                where: { user_id: userId }
            })
        ]);

        res.json({
            status: 'success',
            data: participations,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Error fetching joined challenges:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch joined challenges',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Link a post to a challenge
exports.linkPostToChallenge = async (req, res) => {
    try {
        const { challengeId, postId } = req.params;
        const userId = req.user.id;

        // Check if challenge exists
        const challenge = await prisma.challenge.findUnique({
            where: { id: challengeId }
        });

        if (!challenge) {
            return res.status(404).json({
                status: 'error',
                message: 'Challenge not found'
            });
        }

        // Check if challenge is active
        if (challenge.status !== 'active' && challenge.status !== 'approved') {
            return res.status(400).json({
                status: 'error',
                message: 'Challenge is not active'
            });
        }

        // Check if user is a participant
        const participant = await prisma.challengeParticipant.findUnique({
            where: {
                unique_challenge_participant: {
                    challenge_id: challengeId,
                    user_id: userId
                }
            }
        });

        if (!participant) {
            return res.status(403).json({
                status: 'error',
                message: 'You must join the challenge before submitting posts'
            });
        }

        const now = new Date();
        const endDate = new Date(challenge.end_date);
        if (now > endDate) {
            return res.status(400).json({
                status: 'error',
                message: 'Challenge has ended'
            });
        }
        if (!isChallengeParticipationOpen(challenge, now)) {
            return res.status(400).json({
                status: 'error',
                message: 'Challenge has not started yet'
            });
        }

        // Check if post exists and belongs to user
        const post = await prisma.post.findUnique({
            where: { id: postId }
        });

        if (!post) {
            return res.status(404).json({
                status: 'error',
                message: 'Post not found'
            });
        }

        if (post.user_id !== userId) {
            return res.status(403).json({
                status: 'error',
                message: 'You can only link your own posts to challenges'
            });
        }

        // Check if post is already linked to this challenge
        const existingLink = await prisma.challengePost.findUnique({
            where: {
                unique_challenge_post: {
                    challenge_id: challengeId,
                    post_id: postId
                }
            }
        });

        if (existingLink) {
            return res.status(400).json({
                status: 'error',
                message: 'Post is already linked to this challenge'
            });
        }

        const maxPerAccount = challenge.max_content_per_account != null
            ? challenge.max_content_per_account
            : DEFAULT_MAX_CONTENT_PER_ACCOUNT;
        const currentCount = await prisma.challengePost.count({
            where: {
                challenge_id: challengeId,
                user_id: userId
            }
        });
        if (currentCount >= maxPerAccount) {
            return res.status(400).json({
                status: 'error',
                code: 'MAX_CHALLENGE_POSTS_REACHED',
                message: 'You have reached the maximum number of posts allowed for this challenge.',
                max_content_per_account: maxPerAccount
            });
        }

        // Link post to challenge
        const challengePost = await prisma.challengePost.create({
            data: {
                challenge_id: challengeId,
                post_id: postId,
                user_id: userId
            },
            include: {
                challenge: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                post: {
                    select: {
                        id: true,
                        title: true
                    }
                }
            }
        });

        res.status(201).json({
            status: 'success',
            message: 'Post successfully linked to challenge',
            data: challengePost
        });
    } catch (error) {
        console.error('Error linking post to challenge:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to link post to challenge',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Create a post directly in a challenge
exports.createPostInChallenge = async (req, res) => {
    try {
        const { challengeId } = req.params;
        const { title, caption, post_category } = req.body;
        const userId = req.user.id;

        // Validate required fields
        if (!title || !post_category) {
            return res.status(400).json({
                status: 'error',
                message: 'Missing required fields: title, post_category'
            });
        }

        // Check if challenge exists
        const challenge = await prisma.challenge.findUnique({
            where: { id: challengeId }
        });

        if (!challenge) {
            return res.status(404).json({
                status: 'error',
                message: 'Challenge not found'
            });
        }

        // Check if challenge is active
        if (challenge.status !== 'active' && challenge.status !== 'approved') {
            return res.status(400).json({
                status: 'error',
                message: 'Challenge is not active'
            });
        }

        const now = new Date();
        const endDate = new Date(challenge.end_date);
        if (now > endDate) {
            return res.status(400).json({
                status: 'error',
                message: 'Challenge has ended'
            });
        }
        if (!isChallengeParticipationOpen(challenge, now)) {
            return res.status(400).json({
                status: 'error',
                message: 'Challenge has not started yet'
            });
        }

        // Check if user is a participant
        const participant = await prisma.challengeParticipant.findUnique({
            where: {
                unique_challenge_participant: {
                    challenge_id: challengeId,
                    user_id: userId
                }
            }
        });

        if (!participant) {
            return res.status(403).json({
                status: 'error',
                message: 'You must join the challenge before submitting posts'
            });
        }

        const maxPerAccount = challenge.max_content_per_account != null
            ? challenge.max_content_per_account
            : DEFAULT_MAX_CONTENT_PER_ACCOUNT;
        const currentCount = await prisma.challengePost.count({
            where: {
                challenge_id: challengeId,
                user_id: userId
            }
        });
        if (currentCount >= maxPerAccount) {
            return res.status(400).json({
                status: 'error',
                code: 'MAX_CHALLENGE_POSTS_REACHED',
                message: 'You have reached the maximum number of posts allowed for this challenge.',
                max_content_per_account: maxPerAccount
            });
        }

        // Verify that the user exists
        const user = await prisma.user.findUnique({
            where: { id: userId }
        });

        if (!user) {
            return res.status(404).json({
                status: 'error',
                message: 'User not found'
            });
        }

        // Get the category ID from the category name
        const category = await prisma.category.findFirst({
            where: {
                name: {
                    mode: 'insensitive',
                    equals: post_category.trim()
                },
                status: 'active'
            }
        });

        if (!category) {
            return res.status(400).json({
                status: 'error',
                message: 'Invalid category'
            });
        }

        // Handle file upload
        let video_url = '';
        let fileType = 'text';
        let filePath = '';
        let mimetype = '';
        let thumbnailUrl = null;
        if (req.file) {
            // File was uploaded to R2 (or local storage as fallback)
            video_url = req.file.r2Url || req.file.localUrl || req.file.supabaseUrl || '';
            fileType = req.file.mimetype.startsWith('image') ? 'image' : 'video';
            filePath = req.file.path;
            mimetype = req.file.mimetype;
        }

        // Prepare video-specific data for HLS processing
        const isVideo = fileType === 'video';
        const processingStatus = isVideo ? 'pending' : null;

        // Create the post (always active when posting to challenge)
        const post = await prisma.post.create({
            data: {
                user_id: userId,
                status: 'active',
                category_id: category.id,
                title,
                description: caption,
                uploadDate: new Date(),
                type: fileType,
                video_url,
                thumbnail_url: null, // Will be populated by background thumbnail generation
                processing_status: processingStatus, // HLS processing status
                content: caption
            }
        });


        // Note: Thumbnails are now generated on the frontend and passed in the request

        // Add video to processing queue for HLS transcoding
        if (isVideo && video_url) {
            console.log("[CHALLENGE] Adding video to processing queue for post:", post.id);
            try {
                const queueJob = await addVideoJob(post.id, video_url);
                console.log('[CHALLENGE] Video queued', { postId: post.id, jobId: queueJob?.id });
            } catch (queueErr) {
                const errMsg = queueErr?.message || 'Failed to queue video for processing';
                console.error('[CHALLENGE] Failed to queue video job', { postId: post.id, error: errMsg });
                await prisma.post.update({
                    where: { id: post.id },
                    data: {
                        processing_status: 'failed',
                        processing_error: errMsg.slice(0, 500),
                    },
                });
            }
        }

        // Update user's post count
        await prisma.user.update({
            where: { id: userId },
            data: {
                posts_count: {
                    increment: 1
                }
            }
        });

        // Automatically link post to challenge
        const challengePost = await prisma.challengePost.create({
            data: {
                challenge_id: challengeId,
                post_id: post.id,
                user_id: userId
            },
            include: {
                challenge: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            }
        });

        // Clear relevant caches
        await clearCacheByPattern('following_posts');
        await clearCacheByPattern('featured_posts');
        await clearCacheByPattern('all_posts');
        await clearCacheByPattern('search_posts');

        emitEvent('post:created', { postId: post.id, userId: userId });

        // HLS video processing is handled in the background

        res.status(201).json({
            status: 'success',
            message: 'Post created and submitted to challenge successfully',
            data: {
                post: {
                    ...post,
                    video_url: video_url,
                    thumbnail_url: thumbnailUrl,
                    // HLS processing info
                    hls_processing: isVideo ? {
                        status: 'pending',
                        message: 'Video is being processed for adaptive streaming. HLS URL will be available shortly.'
                    } : null
                },
                challenge_post: challengePost
            }
        });
    } catch (error) {
        console.error('Error creating post in challenge:', error);

        // Handle specific Prisma errors
        if (error.code === 'P2003') {
            return res.status(400).json({
                status: 'error',
                message: 'Foreign key constraint violation. User or category not found.',
                details: error.meta
            });
        }

        res.status(500).json({
            status: 'error',
            message: 'Failed to create post in challenge',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ===== CHALLENGE STATISTICS ENDPOINTS =====

// Get challenges with most participants
exports.getChallengesWithMostParticipants = async (req, res) => {
    try {
        const { limit = 10 } = req.query;

        const challenges = await prisma.challenge.findMany({
            where: {
                status: {
                    in: ['approved', 'active']
                }
            },
            include: {
                organizer: {
                    select: {
                        id: true,
                        username: true,
                        display_name: true,
                        profile_picture: true
                    }
                },
                _count: {
                    select: {
                        participants: true,
                        posts: true
                    }
                }
            },
            orderBy: {
                participants: {
                    _count: 'desc'
                }
            },
            take: parseInt(limit)
        });

        const challengesWithStats = challenges.map(challenge => ({
            ...challenge,
            participant_count: challenge._count.participants,
            post_count: challenge._count.posts
        }));

        res.json({
            status: 'success',
            data: challengesWithStats
        });
    } catch (error) {
        console.error('Error fetching challenges with most participants:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch challenges',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get users with most challenges organized
exports.getUsersWithMostChallenges = async (req, res) => {
    try {
        const { limit = 10 } = req.query;

        const users = await prisma.user.findMany({
            include: {
                _count: {
                    select: {
                        organizedChallenges: true
                    }
                },
                organizedChallenges: {
                    where: {
                        status: {
                            in: ['approved', 'active', 'ended', 'stopped']
                        }
                    },
                    select: {
                        id: true,
                        name: true,
                        status: true,
                        _count: {
                            select: {
                                participants: true,
                                posts: true
                            }
                        }
                    }
                }
            },
            orderBy: {
                organizedChallenges: {
                    _count: 'desc'
                }
            },
            take: parseInt(limit)
        });

        const usersWithStats = users
            .filter(user => user._count.organizedChallenges > 0)
            .map(user => ({
                id: user.id,
                username: user.username,
                display_name: user.display_name,
                profile_picture: user.profile_picture,
                total_challenges: user._count.organizedChallenges,
                challenges: user.organizedChallenges.map(challenge => ({
                    id: challenge.id,
                    name: challenge.name,
                    status: challenge.status,
                    participant_count: challenge._count.participants,
                    post_count: challenge._count.posts
                }))
            }));

        res.json({
            status: 'success',
            data: usersWithStats
        });
    } catch (error) {
        console.error('Error fetching users with most challenges:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch users',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get most rewarding challenges
exports.getMostRewardingChallenges = async (req, res) => {
    try {
        const { limit = 10 } = req.query;

        const challenges = await prisma.challenge.findMany({
            where: {
                has_rewards: true,
                status: {
                    in: ['approved', 'active', 'ended']
                }
            },
            include: {
                organizer: {
                    select: {
                        id: true,
                        username: true,
                        display_name: true,
                        profile_picture: true
                    }
                },
                _count: {
                    select: {
                        participants: true,
                        posts: true
                    }
                }
            },
            orderBy: {
                participants: {
                    _count: 'desc'
                }
            },
            take: parseInt(limit)
        });

        const challengesWithStats = challenges.map(challenge => ({
            id: challenge.id,
            name: challenge.name,
            description: challenge.description,
            rewards: challenge.rewards,
            has_rewards: challenge.has_rewards,
            organizer: challenge.organizer,
            start_date: challenge.start_date,
            end_date: challenge.end_date,
            status: challenge.status,
            participant_count: challenge._count.participants,
            post_count: challenge._count.posts
        }));

        res.json({
            status: 'success',
            data: challengesWithStats
        });
    } catch (error) {
        console.error('Error fetching most rewarding challenges:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch challenges',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get challenges with most posts
exports.getChallengesWithMostPosts = async (req, res) => {
    try {
        const { limit = 10 } = req.query;

        const challenges = await prisma.challenge.findMany({
            where: {
                status: {
                    in: ['approved', 'active', 'ended']
                }
            },
            include: {
                organizer: {
                    select: {
                        id: true,
                        username: true,
                        display_name: true,
                        profile_picture: true
                    }
                },
                _count: {
                    select: {
                        participants: true,
                        posts: true
                    }
                }
            },
            orderBy: {
                posts: {
                    _count: 'desc'
                }
            },
            take: parseInt(limit)
        });

        const challengesWithStats = challenges.map(challenge => ({
            ...challenge,
            participant_count: challenge._count.participants,
            post_count: challenge._count.posts
        }));

        res.json({
            status: 'success',
            data: challengesWithStats
        });
    } catch (error) {
        console.error('Error fetching challenges with most posts:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch challenges',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get overall challenge statistics
exports.getChallengeStatistics = async (req, res) => {
    try {
        const [
            totalChallenges,
            activeChallenges,
            endedChallenges,
            totalParticipants,
            totalPosts,
            challengesWithRewards,
            topChallengesByParticipants,
            topChallengesByPosts
        ] = await Promise.all([
            prisma.challenge.count({
                where: {
                    status: {
                        in: ['approved', 'active', 'ended']
                    }
                }
            }),
            prisma.challenge.count({
                where: {
                    status: 'active'
                }
            }),
            prisma.challenge.count({
                where: {
                    status: {
                        in: ['ended', 'stopped']
                    }
                }
            }),
            prisma.challengeParticipant.count(),
            prisma.challengePost.count(),
            prisma.challenge.count({
                where: {
                    has_rewards: true,
                    status: {
                        in: ['approved', 'active', 'ended', 'stopped']
                    }
                }
            }),
            prisma.challenge.findMany({
                where: {
                    status: {
                        in: ['approved', 'active']
                    }
                },
                include: {
                    _count: {
                        select: {
                            participants: true
                        }
                    }
                },
                orderBy: {
                    participants: {
                        _count: 'desc'
                    }
                },
                take: 5
            }),
            prisma.challenge.findMany({
                where: {
                    status: {
                        in: ['approved', 'active']
                    }
                },
                include: {
                    _count: {
                        select: {
                            posts: true
                        }
                    }
                },
                orderBy: {
                    posts: {
                        _count: 'desc'
                    }
                },
                take: 5
            })
        ]);

        res.json({
            status: 'success',
            data: {
                overview: {
                    total_challenges: totalChallenges,
                    active_challenges: activeChallenges,
                    ended_challenges: endedChallenges,
                    total_participants: totalParticipants,
                    total_posts: totalPosts,
                    challenges_with_rewards: challengesWithRewards
                },
                top_challenges_by_participants: topChallengesByParticipants.map(challenge => ({
                    id: challenge.id,
                    name: challenge.name,
                    participant_count: challenge._count.participants
                })),
                top_challenges_by_posts: topChallengesByPosts.map(challenge => ({
                    id: challenge.id,
                    name: challenge.name,
                    post_count: challenge._count.posts
                }))
            }
        });
    } catch (error) {
        console.error('Error fetching challenge statistics:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to fetch statistics',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

