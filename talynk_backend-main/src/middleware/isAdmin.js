const prisma = require('../lib/prisma');

exports.isAdmin = async (req, res, next) => {
    try {
        if (!req.user || req.user.role !== 'admin') {
            return res.status(403).json({
                status: 'error',
                message: 'Access denied. Admin privileges required.'
            });
        }
        next();
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Error checking admin privileges'
        });
    }
}; 