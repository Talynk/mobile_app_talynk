const prisma = require('../lib/prisma');
/**
 * Background job to refresh user metrics
 * This should be scheduled to run daily
 */
const sequelize = db.sequelize;

async function refreshUserMetrics() {
  try {
    console.log('Starting user metrics refresh job...');
    
    // Update follower_count for all users
    await sequelize.query(`
      UPDATE users u
      SET follower_count = (
        SELECT COUNT(*) 
        FROM follows 
        WHERE "followingId" = u.id
      )
    `, { type: QueryTypes.UPDATE });
    
    // Update posts_count for all users
    await sequelize.query(`
      UPDATE users u
      SET posts_count = (
        SELECT COUNT(*)
        FROM posts
        WHERE user_id = u.id
      )
    `, { type: QueryTypes.UPDATE });
    
    console.log('User metrics refresh job completed successfully');
  } catch (error) {
    console.error('Error in user metrics refresh job:', error);
  }
}

// Export for cron job or manual execution
module.exports = refreshUserMetrics;

// Run the job if executed directly
if (require.main === module) {
  refreshUserMetrics()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
} 