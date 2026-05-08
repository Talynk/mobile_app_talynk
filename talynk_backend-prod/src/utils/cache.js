const NodeCache = require('node-cache');
const { getClient, redisReady } = require('../lib/redis');

// Redis-aware helpers
const redisClient = () => (redisReady() ? getClient() : null);
const toJson = (value) => JSON.stringify(value);
const fromJson = (value) => {
    try {
        return value ? JSON.parse(value) : null;
    } catch (err) {
        console.warn('[Cache] failed to parse cached JSON', err);
        return null;
    }
};

// Create cache instances for different data types as local fallback
const featuredPostsCache = new NodeCache({ stdTTL: 300, checkperiod: 60, useClones: false });
const followingPostsCache = new NodeCache({ stdTTL: 180, checkperiod: 60, useClones: false });
const allPostsCache = new NodeCache({ stdTTL: 120, checkperiod: 60, useClones: false });
const singlePostCache = new NodeCache({ stdTTL: 600, checkperiod: 120, useClones: false });
const searchCache = new NodeCache({ stdTTL: 300, checkperiod: 60, useClones: false });
const userCache = new NodeCache({ stdTTL: 600, checkperiod: 120, useClones: false });

// Cache keys
const CACHE_KEYS = {
    FEATURED_POSTS: 'featured_posts',
    FOLLOWING_POSTS: 'following_posts',
    ALL_POSTS: 'all_posts',
    SINGLE_POST: 'single_post',
    SEARCH_POSTS: 'search_posts',
    USER_FOLLOWING: 'user_following',
    USER_FOLLOWERS: 'user_followers',
    FEED_PUBLIC: 'feed:public',
    FEED_USER: 'feed:user'
};

/**
 * Get cached featured posts
 * @param {string} key - Cache key
 * @returns {Array|null} Cached data or null
 */
const getFeaturedPostsCache = async (key) => {
    const redis = redisClient();
    if (redis) {
        const cached = await redis.get(key);
        if (cached) return fromJson(cached);
    }
    return featuredPostsCache.get(key);
};

/**
 * Set featured posts cache
 * @param {string} key - Cache key
 * @param {Array} data - Data to cache
 * @param {number} ttl - Time to live in seconds
 */
const setFeaturedPostsCache = async (key, data, ttl = 300) => {
    const redis = redisClient();
    if (redis) {
        await redis.set(key, toJson(data), 'EX', ttl);
    }
    featuredPostsCache.set(key, data, ttl);
};

/**
 * Get cached following posts
 * @param {string} key - Cache key
 * @returns {Array|null} Cached data or null
 */
const getFollowingPostsCache = async (key) => {
    const redis = redisClient();
    if (redis) {
        const cached = await redis.get(key);
        if (cached) return fromJson(cached);
    }
    return followingPostsCache.get(key);
};

/**
 * Set following posts cache
 * @param {string} key - Cache key
 * @param {Array} data - Data to cache
 * @param {number} ttl - Time to live in seconds
 */
const setFollowingPostsCache = async (key, data, ttl = 180) => {
    const redis = redisClient();
    if (redis) {
        await redis.set(key, toJson(data), 'EX', ttl);
    }
    followingPostsCache.set(key, data, ttl);
};

/**
 * Get cached user data
 * @param {string} key - Cache key
 * @returns {Object|null} Cached data or null
 */
const getUserCache = async (key) => {
    const redis = redisClient();
    if (redis) {
        const cached = await redis.get(key);
        if (cached) return fromJson(cached);
    }
    return userCache.get(key);
};

/**
 * Set user cache
 * @param {string} key - Cache key
 * @param {Object} data - Data to cache
 * @param {number} ttl - Time to live in seconds
 */
const setUserCache = async (key, data, ttl = 600) => {
    const redis = redisClient();
    if (redis) {
        await redis.set(key, toJson(data), 'EX', ttl);
    }
    userCache.set(key, data, ttl);
};

/**
 * Get cached all posts
 * @param {string} key - Cache key
 * @returns {Array|null} Cached data or null
 */
const getAllPostsCache = async (key) => {
    const redis = redisClient();
    if (redis) {
        const cached = await redis.get(key);
        if (cached) return fromJson(cached);
    }
    return allPostsCache.get(key);
};

/**
 * Set all posts cache
 * @param {string} key - Cache key
 * @param {Array} data - Data to cache
 * @param {number} ttl - Time to live in seconds
 */
const setAllPostsCache = async (key, data, ttl = 120) => {
    const redis = redisClient();
    if (redis) {
        await redis.set(key, toJson(data), 'EX', ttl);
    }
    allPostsCache.set(key, data, ttl);
};

/**
 * Get cached single post
 * @param {string} key - Cache key
 * @returns {Object|null} Cached data or null
 */
const getSinglePostCache = async (key) => {
    const redis = redisClient();
    if (redis) {
        const cached = await redis.get(key);
        if (cached) return fromJson(cached);
    }
    return singlePostCache.get(key);
};

/**
 * Set single post cache
 * @param {string} key - Cache key
 * @param {Object} data - Data to cache
 * @param {number} ttl - Time to live in seconds
 */
const setSinglePostCache = async (key, data, ttl = 600) => {
    const redis = redisClient();
    if (redis) {
        await redis.set(key, toJson(data), 'EX', ttl);
    }
    singlePostCache.set(key, data, ttl);
};

/**
 * Get cached search results
 * @param {string} key - Cache key
 * @returns {Array|null} Cached data or null
 */
const getSearchCache = async (key) => {
    const redis = redisClient();
    if (redis) {
        const cached = await redis.get(key);
        if (cached) return fromJson(cached);
    }
    return searchCache.get(key);
};

/**
 * Set search cache
 * @param {string} key - Cache key
 * @param {Array} data - Data to cache
 * @param {number} ttl - Time to live in seconds
 */
const setSearchCache = async (key, data, ttl = 300) => {
    const redis = redisClient();
    if (redis) {
        await redis.set(key, toJson(data), 'EX', ttl);
    }
    searchCache.set(key, data, ttl);
};

/**
 * Clear cache by pattern
 * @param {string} pattern - Pattern to match cache keys
 */
const clearCacheByPattern = async (pattern) => {
    const redis = redisClient();
    if (redis) {
        const stream = redis.scanStream({ match: `*${pattern}*`, count: 100 });
        const deletes = [];
        stream.on('data', (keys) => {
            if (keys.length) {
                deletes.push(redis.del(...keys));
            }
        });
        await new Promise((resolve, reject) => {
            stream.on('end', resolve);
            stream.on('error', reject);
        });
        await Promise.all(deletes);
    }

    featuredPostsCache.keys().forEach(key => key.includes(pattern) && featuredPostsCache.del(key));
    followingPostsCache.keys().forEach(key => key.includes(pattern) && followingPostsCache.del(key));
    allPostsCache.keys().forEach(key => key.includes(pattern) && allPostsCache.del(key));
    singlePostCache.keys().forEach(key => key.includes(pattern) && singlePostCache.del(key));
    searchCache.keys().forEach(key => key.includes(pattern) && searchCache.del(key));
    userCache.keys().forEach(key => key.includes(pattern) && userCache.del(key));
};

/**
 * Clear all caches
 */
const clearAllCaches = async () => {
    const redis = redisClient();
    if (redis) {
        await redis.flushall();
    }
    featuredPostsCache.flushAll();
    followingPostsCache.flushAll();
    allPostsCache.flushAll();
    singlePostCache.flushAll();
    searchCache.flushAll();
    userCache.flushAll();
};

/**
 * Get cache statistics
 * @returns {Object} Cache statistics
 */
const getCacheStats = () => {
    return {
        featuredPosts: {
            keys: featuredPostsCache.keys().length,
            stats: featuredPostsCache.getStats()
        },
        followingPosts: {
            keys: followingPostsCache.keys().length,
            stats: followingPostsCache.getStats()
        },
        allPosts: {
            keys: allPostsCache.keys().length,
            stats: allPostsCache.getStats()
        },
        singlePost: {
            keys: singlePostCache.keys().length,
            stats: singlePostCache.getStats()
        },
        search: {
            keys: searchCache.keys().length,
            stats: searchCache.getStats()
        },
        users: {
            keys: userCache.keys().length,
            stats: userCache.getStats()
        }
    };
};

module.exports = {
    CACHE_KEYS,
    getFeaturedPostsCache,
    setFeaturedPostsCache,
    getFollowingPostsCache,
    setFollowingPostsCache,
    getAllPostsCache,
    setAllPostsCache,
    getSinglePostCache,
    setSinglePostCache,
    getSearchCache,
    setSearchCache,
    getUserCache,
    setUserCache,
    clearCacheByPattern,
    clearAllCaches,
    getCacheStats
};
