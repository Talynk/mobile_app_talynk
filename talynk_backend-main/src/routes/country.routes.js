const express = require('express');
const router = express.Router();

// Import middleware
const { authenticate } = require('../middleware/auth');
const { isAdmin } = require('../middleware/isAdmin');

// Import controllers
const countryController = require('../controllers/countryController');

// Public routes
router.get('/', countryController.getAllCountries);
router.get('/search', countryController.searchCountries);
router.get('/:id', countryController.getCountryById);
router.get('/:id/stats', countryController.getCountryStats);

// Admin routes
router.post('/', authenticate, isAdmin, countryController.createCountry);
router.put('/:id', authenticate, isAdmin, countryController.updateCountry);
router.delete('/:id', authenticate, isAdmin, countryController.deleteCountry);

module.exports = router;
