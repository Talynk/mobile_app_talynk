const prisma = require('../lib/prisma');

exports.getActiveAds = async (req, res) => {
    try {
        const ads = await prisma.ad.findMany({
            where: { status: 'active' },
            orderBy: { upload_date: 'desc' },
            include: {
                admin: {
                    select: { username: true }
                }
            }
        });

        res.json({
            status: 'success',
            data: { ads }
        });
    } catch (error) {
        console.error('Ads fetch error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error fetching ads'
        });
    }
};

exports.deleteAd = async (req, res) => {
    try {
        const { adId } = req.params;
        const adminUsername = req.user.username;

        const admin = await prisma.admin.findUnique({
            where: { username: adminUsername }
        });
        
        if (!admin || !admin.ads_management) {
            return res.status(403).json({
                status: 'error',
                message: 'Not authorized to manage ads'
            });
        }

        await prisma.ad.update({
            where: { adID: adId },
            data: { status: 'deleted' }
        });

        res.json({
            status: 'success',
            message: 'Ad deleted successfully'
        });
    } catch (error) {
        console.error('Ad deletion error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error deleting ad'
        });
    }
}; 