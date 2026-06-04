const { clearCacheByPattern, CACHE_KEYS } = require('./cache');

const invalidatePostCaches = async () => {
    await clearCacheByPattern(CACHE_KEYS.SINGLE_POST);
    await clearCacheByPattern(CACHE_KEYS.ALL_POSTS);
    await clearCacheByPattern(CACHE_KEYS.FOLLOWING_POSTS);
    await clearCacheByPattern(CACHE_KEYS.FEATURED_POSTS);
    await clearCacheByPattern(CACHE_KEYS.SEARCH_POSTS);
    await clearCacheByPattern('search_');
    await clearCacheByPattern('feed:');
};

module.exports = {
    invalidatePostCaches
};
