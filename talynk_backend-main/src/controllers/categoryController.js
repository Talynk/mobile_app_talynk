const prisma = require('../lib/prisma');

// Get all categories with hierarchy
exports.getAllCategories = async (req, res) => {
    try {
        const { status = 'active', include_subcategories = 'true' } = req.query;

        // Get main categories with their subcategories
        const categories = await prisma.category.findMany({
            where: {
                status: status,
                level: 1 // Only main categories
            },
            select: {
                id: true,
                name: true,
                description: true,
                status: true,
                level: true,
                sort_order: true,
                _count: {
                    select: {
                        posts: {
                            where: {
                                status: 'active',
                                is_frozen: false
                            }
                        }
                    }
                },
                children: include_subcategories === 'true' ? {
                    select: {
                        id: true,
                        name: true,
                        description: true,
                        status: true,
                        level: true,
                        sort_order: true,
                        _count: {
                            select: {
                                posts: {
                                    where: {
                                        status: 'active',
                                        is_frozen: false
                                    }
                                }
                            }
                        }
                    },
                    orderBy: {
                        sort_order: 'asc'
                    }
                } : false
            },
            orderBy: {
                sort_order: 'asc'
            }
        });

        // Ensure each category has an "Other" subcategory
        if (include_subcategories === 'true') {
            for (const category of categories) {
                const hasOther = category.children?.some(child => child.name === 'Other');
                
                if (!hasOther) {
                    // Check if "Other" subcategory exists but wasn't returned (maybe inactive)
                    const otherSubcategory = await prisma.category.findFirst({
                        where: {
                            parent_id: category.id,
                            name: 'Other',
                            level: 2
                        }
                    });

                    if (otherSubcategory) {
                        // Add it to the children array
                        if (!category.children) {
                            category.children = [];
                        }
                        category.children.push({
                            id: otherSubcategory.id,
                            name: otherSubcategory.name,
                            description: otherSubcategory.description,
                            status: otherSubcategory.status,
                            level: otherSubcategory.level,
                            sort_order: otherSubcategory.sort_order,
                            _count: {
                                posts: await prisma.post.count({
                                    where: {
                                        category_id: otherSubcategory.id,
                                        status: 'active',
                                        is_frozen: false
                                    }
                                })
                            }
                        });
                        // Re-sort to ensure "Other" is last
                        category.children.sort((a, b) => {
                            if (a.name === 'Other') return 1;
                            if (b.name === 'Other') return -1;
                            return a.sort_order - b.sort_order;
                        });
                    } else {
                        // Create "Other" subcategory for this parent if it doesn't exist
                        const maxSortOrder = category.children?.length > 0
                            ? Math.max(...category.children.map(c => c.sort_order))
                            : 0;
                        
                        try {
                            const newOther = await prisma.category.create({
                                data: {
                                    name: 'Other',
                                    description: `Other under ${category.name}`,
                                    status: 'active',
                                    level: 2,
                                    parent_id: category.id,
                                    sort_order: maxSortOrder + 1
                                }
                            });

                            if (!category.children) {
                                category.children = [];
                            }
                            category.children.push({
                                id: newOther.id,
                                name: newOther.name,
                                description: newOther.description,
                                status: newOther.status,
                                level: newOther.level,
                                sort_order: newOther.sort_order,
                                _count: {
                                    posts: 0
                                }
                            });
                            // Re-sort to ensure "Other" is last
                            category.children.sort((a, b) => {
                                if (a.name === 'Other') return 1;
                                if (b.name === 'Other') return -1;
                                return a.sort_order - b.sort_order;
                            });
                        } catch (createError) {
                            // Handle unique constraint error - if "Other" already exists for this parent
                            if (createError.code === 'P2002') {
                                // Fetch the existing "Other" for this parent
                                const existingOther = await prisma.category.findFirst({
                                    where: {
                                        parent_id: category.id,
                                        name: 'Other',
                                        level: 2
                                    }
                                });
                                
                                if (existingOther) {
                                    if (!category.children) {
                                        category.children = [];
                                    }
                                    category.children.push({
                                        id: existingOther.id,
                                        name: existingOther.name,
                                        description: existingOther.description,
                                        status: existingOther.status,
                                        level: existingOther.level,
                                        sort_order: existingOther.sort_order,
                                        _count: {
                                            posts: await prisma.post.count({
                                                where: {
                                                    category_id: existingOther.id,
                                                    status: 'active',
                                                    is_frozen: false
                                                }
                                            })
                                        }
                                    });
                                    // Re-sort to ensure "Other" is last
                                    category.children.sort((a, b) => {
                                        if (a.name === 'Other') return 1;
                                        if (b.name === 'Other') return -1;
                                        return a.sort_order - b.sort_order;
                                    });
                                }
                            } else {
                                throw createError;
                            }
                        }
                    }
                } else {
                    // Ensure "Other" is always last in the list
                    if (category.children) {
                        category.children.sort((a, b) => {
                            if (a.name === 'Other') return 1;
                            if (b.name === 'Other') return -1;
                            return a.sort_order - b.sort_order;
                        });
                    }
                }
            }
        }

        res.json({
            status: 'success',
            data: categories
        });

    } catch (error) {
        console.error('Get categories error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching categories',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get subcategories for a main category
exports.getSubcategories = async (req, res) => {
    try {
        const { parentId } = req.params;
        const { status = 'active' } = req.query;

        const subcategories = await prisma.category.findMany({
            where: {
                parent_id: parseInt(parentId),
                status: status,
                level: 2
            },
            select: {
                id: true,
                name: true,
                description: true,
                status: true,
                level: true,
                sort_order: true,
                parent_id: true,
                _count: {
                    select: {
                        posts: {
                            where: {
                                status: 'active',
                                is_frozen: false
                            }
                        }
                    }
                }
            },
            orderBy: {
                sort_order: 'asc'
            }
        });

        // Ensure "Other" subcategory exists
        const hasOther = subcategories.some(sub => sub.name === 'Other');
        
        if (!hasOther) {
            // Check if "Other" exists but is inactive
            const otherSubcategory = await prisma.category.findFirst({
                where: {
                    parent_id: parseInt(parentId),
                    name: 'Other',
                    level: 2
                }
            });

            if (otherSubcategory) {
                // Add it to the list
                const otherCount = await prisma.post.count({
                    where: {
                        category_id: otherSubcategory.id,
                        status: 'active',
                        is_frozen: false
                    }
                });
                
                subcategories.push({
                    id: otherSubcategory.id,
                    name: otherSubcategory.name,
                    description: otherSubcategory.description,
                    status: otherSubcategory.status,
                    level: otherSubcategory.level,
                    sort_order: otherSubcategory.sort_order,
                    parent_id: otherSubcategory.parent_id,
                    _count: {
                        posts: otherCount
                    }
                });
            } else {
                // Create "Other" subcategory for this parent if it doesn't exist
                const parentCategory = await prisma.category.findUnique({
                    where: { id: parseInt(parentId) }
                });

                if (parentCategory) {
                    const maxSortOrder = subcategories.length > 0
                        ? Math.max(...subcategories.map(s => s.sort_order))
                        : 0;
                    
                    try {
                        const newOther = await prisma.category.create({
                            data: {
                                name: 'Other',
                                description: `Other under ${parentCategory.name}`,
                                status: 'active',
                                level: 2,
                                parent_id: parseInt(parentId),
                                sort_order: maxSortOrder + 1
                            }
                        });

                        subcategories.push({
                            id: newOther.id,
                            name: newOther.name,
                            description: newOther.description,
                            status: newOther.status,
                            level: newOther.level,
                            sort_order: newOther.sort_order,
                            parent_id: newOther.parent_id,
                            _count: {
                                posts: 0
                            }
                        });
                    } catch (createError) {
                        // Handle unique constraint error - if "Other" already exists for this parent
                        if (createError.code === 'P2002') {
                            // Fetch the existing "Other" for this parent
                            const existingOther = await prisma.category.findFirst({
                                where: {
                                    parent_id: parseInt(parentId),
                                    name: 'Other',
                                    level: 2
                                }
                            });
                            
                            if (existingOther) {
                                subcategories.push({
                                    id: existingOther.id,
                                    name: existingOther.name,
                                    description: existingOther.description,
                                    status: existingOther.status,
                                    level: existingOther.level,
                                    sort_order: existingOther.sort_order,
                                    parent_id: existingOther.parent_id,
                                    _count: {
                                        posts: await prisma.post.count({
                                            where: {
                                                category_id: existingOther.id,
                                                status: 'active',
                                                is_frozen: false
                                            }
                                        })
                                    }
                                });
                            }
                        } else {
                            throw createError;
                        }
                    }
                }
            }
        }

        // Ensure "Other" is always last
        subcategories.sort((a, b) => {
            if (a.name === 'Other') return 1;
            if (b.name === 'Other') return -1;
            return a.sort_order - b.sort_order;
        });

        res.json({
            status: 'success',
            data: subcategories
        });

    } catch (error) {
        console.error('Get subcategories error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching subcategories',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get category by ID
exports.getCategoryById = async (req, res) => {
    try {
        const { id } = req.params;

        const category = await prisma.category.findUnique({
            where: { id: parseInt(id) },
            include: {
                posts: {
                    where: {
                        status: 'active',
                        is_frozen: false
                    },
                    include: {
                        user: {
                            select: {
                                id: true,
                                username: true,
                                profile_picture: true
                            }
                        }
                    },
                    orderBy: {
                        createdAt: 'desc'
                    },
                    take: 10
                },
                _count: {
                    select: {
                        posts: {
                            where: {
                                status: 'active',
                                is_frozen: false
                            }
                        }
                    }
                }
            }
        });

        if (!category) {
            return res.status(404).json({
                status: 'error',
                message: 'Category not found'
            });
        }

        res.json({
            status: 'success',
            data: category
        });

    } catch (error) {
        console.error('Get category error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching category',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Create new category (Admin only)
exports.createCategory = async (req, res) => {
    try {
        const { name, description } = req.body;

        if (!name) {
            return res.status(400).json({
                status: 'error',
                message: 'Category name is required'
            });
        }

        // Check if category already exists
        const existingCategory = await prisma.category.findFirst({
            where: {
                name: {
                    mode: 'insensitive',
                    equals: name
                }
            }
        });

        if (existingCategory) {
            return res.status(400).json({
                status: 'error',
                message: 'Category with this name already exists'
            });
        }

        const category = await prisma.category.create({
            data: {
                name: name.trim(),
                description: description || null,
                status: 'active'
            }
        });

        res.status(201).json({
            status: 'success',
            message: 'Category created successfully',
            data: category
        });

    } catch (error) {
        console.error('Create category error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error creating category',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Update category (Admin only)
exports.updateCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description, status } = req.body;

        const category = await prisma.category.findUnique({
            where: { id: parseInt(id) }
        });

        if (!category) {
            return res.status(404).json({
                status: 'error',
                message: 'Category not found'
            });
        }

        // Check if new name conflicts with existing category
        if (name && name !== category.name) {
            const existingCategory = await prisma.category.findFirst({
                where: {
                    name: {
                        mode: 'insensitive',
                        equals: name
                    },
                    id: {
                        not: parseInt(id)
                    }
                }
            });

            if (existingCategory) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Category with this name already exists'
                });
            }
        }

        const updatedCategory = await prisma.category.update({
            where: { id: parseInt(id) },
            data: {
                ...(name && { name: name.trim() }),
                ...(description !== undefined && { description }),
                ...(status && { status })
            }
        });

        res.json({
            status: 'success',
            message: 'Category updated successfully',
            data: updatedCategory
        });

    } catch (error) {
        console.error('Update category error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error updating category',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Delete category (Admin only)
exports.deleteCategory = async (req, res) => {
    try {
        const { id } = req.params;

        const category = await prisma.category.findUnique({
            where: { id: parseInt(id) },
            include: {
                _count: {
                    select: {
                        posts: true
                    }
                }
            }
        });

        if (!category) {
            return res.status(404).json({
                status: 'error',
                message: 'Category not found'
            });
        }

        if (category._count.posts > 0) {
            return res.status(400).json({
                status: 'error',
                message: 'Cannot delete category with existing posts. Please reassign posts to other categories first.'
            });
        }

        await prisma.category.delete({
            where: { id: parseInt(id) }
        });

        res.json({
            status: 'success',
            message: 'Category deleted successfully'
        });

    } catch (error) {
        console.error('Delete category error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error deleting category',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get popular categories
exports.getPopularCategories = async (req, res) => {
    try {
        const { limit = 10 } = req.query;

        const categories = await prisma.category.findMany({
            where: {
                status: 'active'
            },
            include: {
                _count: {
                    select: {
                        posts: {
                            where: {
                                status: 'active',
                                is_frozen: false,
                                createdAt: {
                                    gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Last 30 days
                                }
                            }
                        }
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

        res.json({
            status: 'success',
            data: categories.map(category => ({
                id: category.id,
                name: category.name,
                description: category.description,
                postCount: category._count.posts
            }))
        });

    } catch (error) {
        console.error('Get popular categories error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching popular categories',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};