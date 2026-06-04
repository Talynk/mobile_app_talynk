const prisma = require('../lib/prisma');
const { getSearchCache, setSearchCache, CACHE_KEYS } = require('../utils/cache');
const { withVideoPlaybackUrl } = require('../utils/postVideoUtils');
const { andFeedReadyFilter } = require('../utils/postFilters');

/**
 * Comprehensive search endpoint that searches posts, users, and challenges
 * Supports filtering by country, dates, categories, and more
 */
exports.search = async (req, res) => {
    try {
        const {
            q, // search query keyword
            type = 'all', // 'all', 'posts', 'users', 'challenges'
            country_id,
            category_id,
            start_date,
            end_date,
            status, // for posts: 'active', 'draft', 'suspended'
            challenge_status, // for challenges: 'pending', 'approved', 'active', 'ended', 'rejected'
            page = 1,
            limit = 20,
            sort = 'relevance' // 'relevance', 'newest', 'oldest', 'most_liked', 'most_viewed'
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);
        const searchQuery = q ? q.trim() : '';

        // If no search query, return empty results
        if (!searchQuery || searchQuery.length === 0) {
            return res.json({
                status: 'success',
                data: {
                    posts: [],
                    users: [],
                    challenges: [],
                    pagination: {
                        total: 0,
                        page: parseInt(page),
                        limit: parseInt(limit),
                        totalPages: 0
                    },
                    filters: {
                        query: '',
                        type,
                        country_id: country_id || null,
                        category_id: category_id || null,
                        start_date: start_date || null,
                        end_date: end_date || null
                    }
                }
            });
        }

        // Create cache key
        const cacheKey = `${CACHE_KEYS.SEARCH_POSTS}_${searchQuery.toLowerCase()}_${type}_${country_id || 'all'}_${category_id || 'all'}_${start_date || 'all'}_${end_date || 'all'}_${status || 'all'}_${challenge_status || 'all'}_${page}_${limit}_${sort}`;

        // Try to get from cache
        const cachedData = await getSearchCache(cacheKey);
        if (cachedData) {
            return res.json({
                status: 'success',
                data: cachedData,
                cached: true
            });
        }

        const results = {
            posts: [],
            users: [],
            challenges: [],
            pagination: {
                total: 0,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: 0
            }
        };

        // Build date filter
        let dateFilter = {};
        if (start_date || end_date) {
            dateFilter = {};
            if (start_date) {
                dateFilter.gte = new Date(start_date);
            }
            if (end_date) {
                dateFilter.lte = new Date(end_date);
            }
        }

        // Search Posts
        if (type === 'all' || type === 'posts') {
            const postWhere = {
                is_frozen: false,
                OR: [
                    {
                        title: {
                            contains: searchQuery,
                            mode: 'insensitive'
                        }
                    },
                    {
                        description: {
                            contains: searchQuery,
                            mode: 'insensitive'
                        }
                    },
                    {
                        content: {
                            contains: searchQuery,
                            mode: 'insensitive'
                        }
                    }
                ]
            };

            // Add status filter
            if (status && ['active', 'draft', 'suspended'].includes(status)) {
                postWhere.status = status;
            } else if (type === 'posts' || type === 'all') {
                // Default to active posts for public search
                postWhere.status = 'active';
            }

            // Add category filter
            if (category_id) {
                postWhere.category_id = parseInt(category_id);
            }

            // Add date filter
            if (Object.keys(dateFilter).length > 0) {
                postWhere.createdAt = dateFilter;
            }

            // Add country filter (through user)
            if (country_id) {
                postWhere.user = {
                    country_id: parseInt(country_id)
                };
            }

            // Determine sort order. Same likes/views → latest first (createdAt desc).
            let postOrderBy = {};
            switch (sort) {
                case 'newest':
                    postOrderBy = { createdAt: 'desc' };
                    break;
                case 'oldest':
                    postOrderBy = { createdAt: 'asc' };
                    break;
                case 'most_liked':
                    postOrderBy = [{ likes: 'desc' }, { createdAt: 'desc' }];
                    break;
                case 'most_viewed':
                    postOrderBy = [{ views: 'desc' }, { createdAt: 'desc' }];
                    break;
                case 'relevance':
                default:
                    // Relevance: prioritize posts with keyword in title, then description
                    postOrderBy = { createdAt: 'desc' };
                    break;
            }

            const [posts, postsTotal] = await Promise.all([
                prisma.post.findMany({
                    where: andFeedReadyFilter(postWhere),
                    include: {
                        user: {
                            select: {
                                id: true,
                                username: true,
                                display_name: true,
                                profile_picture: true,
                                country: {
                                    select: {
                                        id: true,
                                        name: true,
                                        code: true,
                                        flag_emoji: true
                                    }
                                }
                            }
                        },
                        category: {
                            select: {
                                id: true,
                                name: true,
                                description: true
                            }
                        },
                        _count: {
                            select: {
                                comments: true,
                                postLikes: true,
                                postViews: true
                            }
                        }
                    },
                    orderBy: postOrderBy,
                    take: parseInt(limit),
                    skip: offset
                }),
                prisma.post.count({ where: andFeedReadyFilter(postWhere) })
            ]);

            results.posts = posts.map(post => {
                const p = withVideoPlaybackUrl(post);
                p.likeCount = post.likes;
                p.viewCount = post.views;
                p.commentCount = post._count.comments;
                return p;
            });
            results.pagination.total += postsTotal;
        }

        // Search Users
        if (type === 'all' || type === 'users') {
            const userWhere = {
                status: 'active',
                OR: [
                    {
                        username: {
                            contains: searchQuery,
                            mode: 'insensitive'
                        }
                    },
                    {
                        display_name: {
                            contains: searchQuery,
                            mode: 'insensitive'
                        }
                    },
                    {
                        email: {
                            contains: searchQuery,
                            mode: 'insensitive'
                        }
                    }
                ]
            };

            // Add country filter
            if (country_id) {
                userWhere.country_id = parseInt(country_id);
            }

            // Add date filter (for account creation)
            if (Object.keys(dateFilter).length > 0) {
                userWhere.createdAt = dateFilter;
            }

            const [users, usersTotal] = await Promise.all([
                prisma.user.findMany({
                    where: userWhere,
                    select: {
                        id: true,
                        username: true,
                        display_name: true,
                        email: true,
                        profile_picture: true,
                        posts_count: true,
                        follower_count: true,
                        country: {
                            select: {
                                id: true,
                                name: true,
                                code: true,
                                flag_emoji: true
                            }
                        },
                        createdAt: true,
                        updatedAt: true
                    },
                    orderBy: {
                        follower_count: 'desc' // Sort by popularity
                    },
                    take: parseInt(limit),
                    skip: offset
                }),
                prisma.user.count({ where: userWhere })
            ]);

            results.users = users;
            results.pagination.total += usersTotal;
        }

        // Search Challenges
        if (type === 'all' || type === 'challenges') {
            const challengeWhere = {
                OR: [
                    {
                        name: {
                            contains: searchQuery,
                            mode: 'insensitive'
                        }
                    },
                    {
                        description: {
                            contains: searchQuery,
                            mode: 'insensitive'
                        }
                    },
                    {
                        organizer_name: {
                            contains: searchQuery,
                            mode: 'insensitive'
                        }
                    }
                ]
            };

            // Add status filter
            if (challenge_status && ['pending', 'approved', 'active', 'ended', 'rejected'].includes(challenge_status)) {
                challengeWhere.status = challenge_status;
            } else if (type === 'challenges' || type === 'all') {
                // Default to approved and active challenges for public search
                challengeWhere.status = {
                    in: ['approved', 'active']
                };
            }

            // Add date filter
            if (Object.keys(dateFilter).length > 0) {
                challengeWhere.OR = [
                    ...challengeWhere.OR,
                    {
                        start_date: dateFilter
                    },
                    {
                        end_date: dateFilter
                    }
                ];
            }

            // Determine sort order
            let challengeOrderBy = {};
            switch (sort) {
                case 'newest':
                    challengeOrderBy = { createdAt: 'desc' };
                    break;
                case 'oldest':
                    challengeOrderBy = { createdAt: 'asc' };
                    break;
                case 'relevance':
                default:
                    challengeOrderBy = { createdAt: 'desc' };
                    break;
            }

            const [challenges, challengesTotal] = await Promise.all([
                prisma.challenge.findMany({
                    where: challengeWhere,
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
                    orderBy: challengeOrderBy,
                    take: parseInt(limit),
                    skip: offset
                }),
                prisma.challenge.count({ where: challengeWhere })
            ]);

            // Determine if challenges are currently active
            const now = new Date();
            results.challenges = challenges.map(challenge => {
                const startDate = new Date(challenge.start_date);
                const endDate = new Date(challenge.end_date);
                const isActive = (challenge.status === 'active' || challenge.status === 'approved') &&
                                now >= startDate && now <= endDate;

                return {
                    ...challenge,
                    is_currently_active: isActive,
                    participant_count: challenge._count.participants,
                    post_count: challenge._count.posts
                };
            });
            results.pagination.total += challengesTotal;
        }

        // Calculate total pages
        results.pagination.totalPages = Math.ceil(results.pagination.total / parseInt(limit));

        // Add filters to response
        results.filters = {
            query: searchQuery,
            type,
            country_id: country_id || null,
            category_id: category_id || null,
            start_date: start_date || null,
            end_date: end_date || null,
            status: status || null,
            challenge_status: challenge_status || null,
            sort
        };

        // Cache the response
        await setSearchCache(cacheKey, results);

        res.json({
            status: 'success',
            data: results,
            cached: false
        });

    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error performing search',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
            data: {
                posts: [],
                users: [],
                challenges: [],
                pagination: {
                    total: 0,
                    page: parseInt(req.query.page) || 1,
                    limit: parseInt(req.query.limit) || 20,
                    totalPages: 0
                }
            }
        });
    }
};
