const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');
const { authenticate } = require('../middleware/auth');
const { isAdmin } = require('../middleware/isAdmin');

// Get all categories with hierarchy
router.get('/', categoryController.getAllCategories);

// Get subcategories for a main category
router.get('/:parentId/subcategories', categoryController.getSubcategories);

// Get popular categories
router.get('/popular', categoryController.getPopularCategories);

// Get category by ID
router.get('/:id', categoryController.getCategoryById);

// Create new category (Admin only)
router.post('/', authenticate, isAdmin, categoryController.createCategory);

// Update category (Admin only)
router.put('/:id', authenticate, isAdmin, categoryController.updateCategory);

// Delete category (Admin only)
router.delete('/:id', authenticate, isAdmin, categoryController.deleteCategory);

module.exports = router;