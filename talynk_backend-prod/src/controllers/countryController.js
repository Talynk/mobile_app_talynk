const prisma = require('../lib/prisma');

/**
 * Get all countries
 */
exports.getAllCountries = async (req, res) => {
    try {
        const { active_only = true } = req.query;
        
        const whereClause = active_only === 'true' ? { is_active: true } : {};
        
        const countries = await prisma.country.findMany({
            where: whereClause,
            orderBy: { name: 'asc' },
            select: {
                id: true,
                name: true,
                code: true,
                flag_emoji: true,
                is_active: true
            }
        });

        res.json({
            status: 'success',
            data: {
                countries
            }
        });

    } catch (error) {
        console.error('Get countries error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching countries'
        });
    }
};

/**
 * Get country by ID
 */
exports.getCountryById = async (req, res) => {
    try {
        const { id } = req.params;
        
        const country = await prisma.country.findUnique({
            where: { id: parseInt(id) },
            include: {
                users: {
                    select: {
                        id: true,
                        username: true,
                        profile_picture: true
                    },
                    take: 10 // Limit to first 10 users
                }
            }
        });

        if (!country) {
            return res.status(404).json({
                status: 'error',
                message: 'Country not found'
            });
        }

        res.json({
            status: 'success',
            data: {
                country
            }
        });

    } catch (error) {
        console.error('Get country error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching country'
        });
    }
};

/**
 * Create new country (Admin only)
 */
exports.createCountry = async (req, res) => {
    try {
        const { name, code, flag_emoji } = req.body;

        // Validate required fields
        if (!name || !code) {
            return res.status(400).json({
                status: 'error',
                message: 'Name and code are required'
            });
        }

        // Check if country already exists
        const existingCountry = await prisma.country.findFirst({
            where: {
                OR: [
                    { name: { mode: 'insensitive', equals: name } },
                    { code: { mode: 'insensitive', equals: code } }
                ]
            }
        });

        if (existingCountry) {
            return res.status(409).json({
                status: 'error',
                message: 'Country with this name or code already exists'
            });
        }

        const country = await prisma.country.create({
            data: {
                name,
                code: code.toUpperCase(),
                flag_emoji
            }
        });

        res.status(201).json({
            status: 'success',
            message: 'Country created successfully',
            data: {
                country
            }
        });

    } catch (error) {
        console.error('Create country error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error creating country'
        });
    }
};

/**
 * Update country (Admin only)
 */
exports.updateCountry = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, code, flag_emoji, is_active } = req.body;

        // Check if country exists
        const existingCountry = await prisma.country.findUnique({
            where: { id: parseInt(id) }
        });

        if (!existingCountry) {
            return res.status(404).json({
                status: 'error',
                message: 'Country not found'
            });
        }

        // Check for conflicts if updating name or code
        if (name || code) {
            const conflictCountry = await prisma.country.findFirst({
                where: {
                    id: { not: parseInt(id) },
                    OR: [
                        name ? { name: { mode: 'insensitive', equals: name } } : {},
                        code ? { code: { mode: 'insensitive', equals: code } } : {}
                    ]
                }
            });

            if (conflictCountry) {
                return res.status(409).json({
                    status: 'error',
                    message: 'Country with this name or code already exists'
                });
            }
        }

        const updateData = {};
        if (name) updateData.name = name;
        if (code) updateData.code = code.toUpperCase();
        if (flag_emoji !== undefined) updateData.flag_emoji = flag_emoji;
        if (is_active !== undefined) updateData.is_active = is_active;

        const country = await prisma.country.update({
            where: { id: parseInt(id) },
            data: updateData
        });

        res.json({
            status: 'success',
            message: 'Country updated successfully',
            data: {
                country
            }
        });

    } catch (error) {
        console.error('Update country error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error updating country'
        });
    }
};

/**
 * Delete country (Admin only)
 */
exports.deleteCountry = async (req, res) => {
    try {
        const { id } = req.params;

        // Check if country exists
        const country = await prisma.country.findUnique({
            where: { id: parseInt(id) },
            include: {
                users: {
                    select: { id: true }
                }
            }
        });

        if (!country) {
            return res.status(404).json({
                status: 'error',
                message: 'Country not found'
            });
        }

        // Check if country has users
        if (country.users.length > 0) {
            return res.status(409).json({
                status: 'error',
                message: 'Cannot delete country with associated users. Please reassign users first.'
            });
        }

        await prisma.country.delete({
            where: { id: parseInt(id) }
        });

        res.json({
            status: 'success',
            message: 'Country deleted successfully'
        });

    } catch (error) {
        console.error('Delete country error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error deleting country'
        });
    }
};

/**
 * Get country statistics
 */
exports.getCountryStats = async (req, res) => {
    try {
        const { id } = req.params;

        const [userCount, postCount] = await Promise.all([
            prisma.user.count({
                where: { country_id: parseInt(id) }
            }),
            prisma.post.count({
                where: {
                    user: {
                        country_id: parseInt(id)
                    },
                    status: 'active'
                }
            })
        ]);

        res.json({
            status: 'success',
            data: {
                userCount,
                postCount
            }
        });

    } catch (error) {
        console.error('Get country stats error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching country statistics'
        });
    }
};

/**
 * Search countries
 */
exports.searchCountries = async (req, res) => {
    try {
        const { q, limit = 20 } = req.query;

        if (!q || q.trim().length < 2) {
            return res.status(400).json({
                status: 'error',
                message: 'Search query must be at least 2 characters'
            });
        }

        const countries = await prisma.country.findMany({
            where: {
                is_active: true,
                OR: [
                    { name: { mode: 'insensitive', contains: q } },
                    { code: { mode: 'insensitive', contains: q } }
                ]
            },
            orderBy: { name: 'asc' },
            take: parseInt(limit),
            select: {
                id: true,
                name: true,
                code: true,
                flag_emoji: true
            }
        });

        res.json({
            status: 'success',
            data: {
                countries,
                query: q,
                count: countries.length
            }
        });

    } catch (error) {
        console.error('Search countries error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error searching countries'
        });
    }
};
