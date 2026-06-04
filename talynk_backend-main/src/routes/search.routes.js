const express = require('express');
const router = express.Router();

// Import controller
const searchController = require('../controllers/searchController');

// Search route (public - no authentication required)
router.get('/', searchController.search);

module.exports = router;
