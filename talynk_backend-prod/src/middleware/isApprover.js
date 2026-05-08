const prisma = require('../lib/prisma');

exports.isApprover = async (req, res, next) => {
    try {
        const approver = await prisma.approver.findUnique({
            where: { id: req.user.id }
        });
        
        if (!approver) {
            return res.status(403).json({
                status: 'error',
                message: 'Access denied. Approver privileges required.'
            });
        }
        
        req.approver = approver;
        next();
    } catch (error) {
        console.error('Approver check error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error checking approver privileges'
        });
    }
}; 