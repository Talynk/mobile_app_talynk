/**
 * Internal API Middleware
 * Authenticates requests using an internal API key
 */

exports.authenticateInternalAPI = (req, res, next) => {
    const ts = new Date().toISOString();
    const route = `${req.method} ${req.originalUrl || req.url || ''}`;
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        console.warn(`[InternalAuth] ${ts} ${route} — Missing Authorization header`);
        return res.status(401).json({
            status: 'error',
            message: 'Missing Authorization header',
        });
    }

    // Extract token from "Bearer <token>"
    const token = authHeader.startsWith('Bearer ')
        ? authHeader.substring(7)
        : authHeader;

    const internalApiKey = process.env.INTERNAL_API_KEY;

    if (!internalApiKey) {
        console.error(`[InternalAuth] ${ts} ${route} — INTERNAL_API_KEY not configured`);
        return res.status(500).json({
            status: 'error',
            message: 'Internal API key not configured',
        });
    }

    if (token !== internalApiKey) {
        console.warn(`[InternalAuth] ${ts} ${route} — Invalid API key`);
        return res.status(403).json({
            status: 'error',
            message: 'Invalid API key',
        });
    }

    // Authentication successful (do not log tokens)
    next();
};
