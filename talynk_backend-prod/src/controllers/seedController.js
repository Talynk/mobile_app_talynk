const fs = require('fs');
const path = require('path');
const prisma = require('../lib/prisma');

const CATEGORY_STATUS = 'active';

// Category hierarchy definition
// Order: Music, Sport, Performance, Beauty, Arts, Communication, Martial Arts
const categoryHierarchy = [
    {
        name: 'Music',
        description: 'Music-related content',
        sort_order: 1,
        children: [
            'Rock',
            'Pop',
            'Hip Hop / Rap',
            'R&B / Soul',
            'Gospel',
            'Jazz',
            'Classical',
            'Reggae',
            'Country',
            'Traditional',
            'Electronic/Dance',
            'Afrobeats',
            'Blues',
            'Folk',
            'Latin',
            'K-Pop',
            'Other'
        ]
    },
    {
        name: 'Sport',
        description: 'Sport-related content',
        sort_order: 2,
        children: [
            'Football',
            'Volleyball',
            'Basketball',
            'Handball',
            'Tennis',
            'Table tennis',
            'Golf',
            'Cricket',
            'Rugby',
            'Acrobatics',
            'Other'
        ]
    },
    {
        name: 'Performance',
        description: 'Performance-related content',
        sort_order: 3,
        children: [
            'Drama/Theatre',
            'Dance',
            'Comedy',
            'Other'
        ]
    },
    {
        name: 'Beauty',
        description: 'Physical appearance related content',
        sort_order: 4,
        children: [
            'Women Beauty',
            'Men',
            'Other'
        ]
    },
    {
        name: 'Arts',
        description: 'Arts-related content',
        sort_order: 5,
        children: [
            'Drawing',
            'Painting',
            'Sculpture',
            'Photography',
            'Graphic design',
            'Fashion design',
            'Interior design',
            'Ceramics',
            'Architecture',
            'Calligraphy',
            'Crafts',
            'Other'
        ]
    },
    {
        name: 'Communication',
        description: 'Communication-related content',
        sort_order: 6,
        children: [
            'Preaching',
            'Public speaking',
            'Motivational speaking',
            'Storytelling',
            'Poetry',
            'Teaching & Training',
            'Other'
        ]
    },
    {
        name: 'Martial Arts',
        description: 'Martial arts and combat sports content',
        sort_order: 7,
        children: [
            'Karate',
            'Kung Fu (Wushu)',
            'Boxing',
            'Taekwondo',
            'Kickboxing',
            'Muay Thai',
            'Judo',
            'Aikido',
            'Jiu-Jitsu',
            'Other'
        ]
    }
];

async function upsertCategory({ name, description, level, sort_order, parent_id = null }) {
    // For level 1 categories (parent_id is null), we can't use composite unique constraint
    // because Prisma doesn't allow null in composite unique where clauses
    if (parent_id === null) {
        // Check if category exists
        const existing = await prisma.category.findFirst({
            where: {
                name,
                level: 1,
                parent_id: null
            }
        });

        if (existing) {
            // Update existing category
            return prisma.category.update({
                where: { id: existing.id },
                data: { description, status: CATEGORY_STATUS, level, sort_order, parent_id }
            });
        } else {
            // Create new category
            return prisma.category.create({
                data: { name, description, status: CATEGORY_STATUS, level, sort_order, parent_id }
            });
        }
    } else {
        // For level 2 categories (parent_id is not null), use composite unique constraint
        return prisma.category.upsert({
            where: { 
                name_parent_id: {
                    name,
                    parent_id
                }
            },
            update: { description, status: CATEGORY_STATUS, level, sort_order, parent_id },
            create: { name, description, status: CATEGORY_STATUS, level, sort_order, parent_id }
        });
    }
}

exports.seedCategories = async (req, res) => {
    try {
        // First, update "Physical Appearance" to "Beauty" if it exists
        const physicalAppearance = await prisma.category.findFirst({
            where: {
                name: 'Physical Appearance',
                level: 1
            }
        });

        if (physicalAppearance) {
            await prisma.category.update({
                where: { id: physicalAppearance.id },
                data: { name: 'Beauty' }
            });
        }

        // Process each category in the hierarchy
        for (const top of categoryHierarchy) {
            const parent = await upsertCategory({
                name: top.name,
                description: top.description,
                level: 1,
                sort_order: top.sort_order,
                parent_id: null
            });

            // Get existing subcategories for this parent
            const existingSubcategories = await prisma.category.findMany({
                where: {
                    parent_id: parent.id,
                    level: 2
                }
            });

            // Create a map of existing subcategories by name
            const existingMap = new Map(
                existingSubcategories.map(sub => [sub.name.toLowerCase(), sub])
            );

            // Filter out "Other" from children to handle it separately
            const childrenWithoutOther = top.children.filter(child => child.toLowerCase() !== 'other');
            
            let childOrder = 1;
            for (const childName of childrenWithoutOther) {
                const childLower = childName.toLowerCase();
                const existing = existingMap.get(childLower);

                if (existing) {
                    // Update existing subcategory's sort_order
                    await prisma.category.update({
                        where: { id: existing.id },
                        data: {
                            sort_order: childOrder++,
                            description: `${childName} under ${top.name}`
                        }
                    });
                } else {
                    // Create new subcategory
                    await upsertCategory({
                        name: childName,
                        description: `${childName} under ${top.name}`,
                        level: 2,
                        sort_order: childOrder++,
                        parent_id: parent.id
                    });
                }
            }

            // Ensure "Other" subcategory exists and is always last
            const otherSubcategory = await prisma.category.findFirst({
                where: {
                    parent_id: parent.id,
                    name: 'Other',
                    level: 2
                }
            });

            // Get the highest sort_order among all subcategories (excluding "Other")
            const maxSortOrderResult = await prisma.category.findFirst({
                where: {
                    parent_id: parent.id,
                    level: 2,
                    name: {
                        not: 'Other'
                    }
                },
                orderBy: {
                    sort_order: 'desc'
                },
                select: {
                    sort_order: true
                }
            });

            const maxSortOrder = maxSortOrderResult?.sort_order || 0;
            const otherSortOrder = maxSortOrder + 1;

            if (otherSubcategory) {
                // Update existing "Other" subcategory to be last
                await prisma.category.update({
                    where: { id: otherSubcategory.id },
                    data: {
                        sort_order: otherSortOrder,
                        description: `Other under ${top.name}`,
                        status: CATEGORY_STATUS
                    }
                });
            } else {
                // Create "Other" subcategory if it doesn't exist
                await upsertCategory({
                    name: 'Other',
                    description: `Other under ${top.name}`,
                    level: 2,
                    sort_order: otherSortOrder,
                    parent_id: parent.id
                });
            }
        }

        res.json({
            status: 'success',
            message: 'Categories seeded successfully'
        });
    } catch (error) {
        console.error('Seed categories error:', error);
        res.status(500).json({ status: 'error', message: 'Error seeding categories' });
    }
};

exports.resetCategories = async (req, res) => {
    try {
        await prisma.category.deleteMany({});
        res.json({ status: 'success', message: 'Categories reset successfully' });
    } catch (error) {
        console.error('Reset categories error:', error);
        res.status(500).json({ status: 'error', message: 'Error resetting categories' });
    }
};

exports.seedCountries = async (req, res) => {
    try {
        const countriesPath = path.join(process.cwd(), 'countries.json');
        const raw = fs.readFileSync(countriesPath, 'utf8');
        const json = JSON.parse(raw);
        // New format: { success: 1, data: [ { name, code, callingCode } ] }
        const countries = Array.isArray(json?.data) ? json.data : (json?.data?.countries || []);

        if (!countries.length) {
            return res.status(400).json({ status: 'error', message: 'No countries in countries.json' });
        }

        // clear and insert
        await prisma.country.deleteMany({});
        await prisma.country.createMany({
            data: countries.map(c => ({
                // Let DB autoincrement IDs if not provided
                // Truncate name to 100 chars (schema limit)
                name: (c.name || '').substring(0, 100),
                // Store ISO alpha-2 codes in uppercase, truncate to 3 chars (schema limit)
                code: ((c.code || '').toUpperCase()).substring(0, 3),
                // Store calling code (keep the + prefix if present), truncate to 20 chars (schema limit)
                phone_code: c.callingCode || c.phone_code ? String(c.callingCode || c.phone_code).substring(0, 20) : null,
                // Truncate flag_emoji to 10 chars (schema limit)
                flag_emoji: c.flag_emoji ? String(c.flag_emoji).substring(0, 10) : null,
                // Default to active
                is_active: typeof c.is_active === 'boolean' ? c.is_active : true
            })),
            skipDuplicates: true
        });

        res.json({ status: 'success', message: `Seeded ${countries.length} countries` });
    } catch (error) {
        console.error('Seed countries error:', error);
        res.status(500).json({ status: 'error', message: 'Error seeding countries' });
    }
};

exports.resetCountries = async (req, res) => {
    try {
        await prisma.country.deleteMany({});
        res.json({ status: 'success', message: 'Countries reset successfully' });
    } catch (error) {
        console.error('Reset countries error:', error);
        res.status(500).json({ status: 'error', message: 'Error resetting countries' });
    }
};

exports.seedAll = async (req, res) => {
    try {
        await exports.seedCountries(req, res);
        // if seedCountries already sent a response, return to avoid headers sent
        if (res.headersSent) return;
        await exports.seedCategories(req, res);
        if (res.headersSent) return;
        res.json({ status: 'success', message: 'Seeded countries and categories' });
    } catch (error) {
        console.error('Seed all error:', error);
        res.status(500).json({ status: 'error', message: 'Error seeding all' });
    }
};

exports.resetAll = async (req, res) => {
    try {
        await prisma.category.deleteMany({});
        await prisma.country.deleteMany({});
        res.json({ status: 'success', message: 'Reset countries and categories' });
    } catch (error) {
        console.error('Reset all error:', error);
        res.status(500).json({ status: 'error', message: 'Error resetting all' });
    }
};


