require("./instrument.js");
require('dotenv').config();
const Sentry = require("@sentry/node");
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const fs = require('fs').promises;
const http = require('http');
const { initRealtime } = require('./lib/realtime');

// Import routes
const routes = require('./routes');

const { startFeedFlusher } = require('./jobs/feedFlusher');

const app = express();

// Trust proxy - required when behind reverse proxy (Caddy)
// This ensures Express correctly handles X-Forwarded-* headers
app.set('trust proxy', true);

// Liveness only: registered before CORS/helmet/logging/routes so probes never touch DB or activity logging.
app.get('/healthz', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ status: 'ok' });
});

// Ensure uploads directory exists on startup
async function ensureUploadsDirectory() {
  try {
    const uploadsDir = path.join(process.cwd(), 'uploads');
    await fs.mkdir(uploadsDir, { recursive: true });
    console.log(`✅ Uploads directory ready: ${uploadsDir}`);
  } catch (error) {
    console.error('Error creating uploads directory:', error.message);
  }
}

// Initialize uploads directory on startup
ensureUploadsDirectory();

// CORS configuration - must be before other middleware
const corsOptions = {
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3001', 
           'http://127.0.0.1:3001', 'http://192.168.56.1:3001', 
           'https://talynk-user-frontend-git-main-ihirwepatricks-projects.vercel.app', 
           'http://localhost:3000', 'https://talynk-test.vercel.app', 
           'https://talynk-management.vercel.app', 
           'https://talynk-user-frontend-production.up.railway.app', 
           'https://talynk.vercel.app', 'https://talentix.net', 'https://admin.talentix.net'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'X-Requested-With', 'Accept', 'Access-Control-Allow-Headers', 'sentry-trace', 'baggage', 'X-Request-Id', 'X-Device-Fingerprint', 'X-Device-Metadata', 'X-Session-Id', 'X-Geo-Location'],
  preflightContinue: false,
  optionsSuccessStatus: 204
};

// Normalize origin (strip trailing slash) for consistent CORS matching
function normalizeOrigin(origin) {
    if (!origin || typeof origin !== 'string') return null;
    return origin.replace(/\/+$/, '') || null;
}
function isOriginAllowed(origin) {
    const normalized = normalizeOrigin(origin);
    if (!normalized) return false;
    return corsOptions.origin.some(allowed => normalizeOrigin(allowed) === normalized);
}

// Manual CORS headers middleware - runs FIRST to ensure headers are always set
app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowed = isOriginAllowed(origin);

    // Debug logging (remove in production)
    if (process.env.NODE_ENV !== 'production') {
        console.log(`[CORS] ${req.method} ${req.path} - Origin: ${origin}`);
    }

    // For OPTIONS requests, always set CORS headers; set Allow-Origin when origin is allowed
    if (req.method === 'OPTIONS') {
        if (origin && allowed) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
        res.setHeader('Access-Control-Allow-Methods', corsOptions.methods.join(', '));
        res.setHeader('Access-Control-Allow-Headers', corsOptions.allowedHeaders.join(', '));
        res.setHeader('Access-Control-Max-Age', '86400');

        if (process.env.NODE_ENV !== 'production') {
            console.log(`[CORS] OPTIONS response headers:`, {
                'Access-Control-Allow-Origin': res.getHeader('Access-Control-Allow-Origin'),
                'Access-Control-Allow-Credentials': res.getHeader('Access-Control-Allow-Credentials'),
                'Access-Control-Allow-Methods': res.getHeader('Access-Control-Allow-Methods')
            });
        }

        return res.status(204).end();
    }

    // For non-OPTIONS requests, set CORS headers if origin is allowed
    if (origin && allowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.setHeader('Access-Control-Allow-Methods', corsOptions.methods.join(', '));
    res.setHeader('Access-Control-Allow-Headers', corsOptions.allowedHeaders.join(', '));

    next();
});

// Apply CORS middleware (as additional layer)
app.use(cors(corsOptions));

// Explicit OPTIONS handler (backup)
app.options('*', (req, res) => {
    const origin = req.headers.origin;
    if (origin && isOriginAllowed(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.setHeader('Access-Control-Allow-Methods', corsOptions.methods.join(', '));
    res.setHeader('Access-Control-Allow-Headers', corsOptions.allowedHeaders.join(', '));
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(204).end();
});

// Basic middleware - configure helmet to not interfere with CORS
app.use(helmet({
    contentSecurityPolicy: false, // For development only
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false
}));

// Add specific CORS handling for problematic routes (using same config)
app.use('/api/posts/all', cors(corsOptions));

// Request-scoped Sentry context (request_id, path, method) for trace-connected logs
const sentryContext = require('./middleware/sentryContext');
app.use(sentryContext);

// Geo-location: derive country from Cloudflare `CF-IPCountry` (primary) with
// offline `geoip-lite` fallback. Attaches `req.geo` for downstream handlers
// (auth/OTP responses) and loggers. Must run after `trust proxy` and before
// any handler that reads `req.geo`. See docs/IP_COUNTRY_DETECTION.md.
const geoLocation = require('./middleware/geoLocation');
app.use(geoLocation);

// Activity logging: trace-level log of every API request (traceId, route, status, duration, IP, device fingerprint)
const requestLogger = require('./middleware/requestLogger');
if (process.env.DISABLE_REQUEST_LOGGER !== 'true') app.use(requestLogger);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(compression());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve uploaded files from uploads directory
app.use('/uploads', (req, res, next) => {
    // Set CORS headers specifically for media files
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range, sentry-trace, baggage');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    
    // Handle OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    next();
}, express.static(path.join(process.cwd(), 'uploads')));

// Routes
app.use('/api', routes);

// All routes are now organized in ./routes/index.js

// API root route
app.get('/', (req, res) => {
    res.json({
        status: 'success',
        message: 'Talynk Backend API is running',
        version: '1.0.0',
        endpoints: {
            auth: '/api/auth',
            users: '/api/users',
            posts: '/api/posts',
            admin: '/api/admin',
            approver: '/api/approver'
        }
    });
});

// Sentry test route (disabled in production)
if (process.env.NODE_ENV !== "production") {
    app.get("/debug-sentry", (req, res) => {
        throw new Error("My first Sentry error!");
    });
}

// The error handler must be registered before any other error middleware and after all controllers
Sentry.setupExpressErrorHandler(app);

// Error Handling Middleware
const notFoundHandler = (req, res) => {
    res.status(404).json({
        status: 'error',
        message: `Route not found - ${req.originalUrl}`
    });
};

const errorHandler = require('./middleware/errorHandler');

app.use(notFoundHandler);
app.use(errorHandler);

// Server setup with port handling
const PORT = process.env.PORT || 3000;

// Video processing/watermarking is handled on the frontend

const startServer = async () => {
    try {
        const server = http.createServer(app);

        server.keepAliveTimeout = 5000;
        server.headersTimeout = 10000;
        server.requestTimeout = 15000;

        if (process.env.DISABLE_REALTIME !== 'true') { await initRealtime(server, corsOptions.origin); }

        server.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
            startFeedFlusher();
        });

        server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.log(`Port ${PORT} is busy, trying ${PORT + 1}`);
                server.close();
                app.listen(PORT + 1);
            } else {
                console.error('Server error:', error);
            }
        });

        // Handle graceful shutdown
        process.on('SIGTERM', () => {
            console.log('SIGTERM received. Shutting down gracefully...');
            server.close(() => {
                console.log('Server closed');
                process.exit(0);
            });
        });

    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();

module.exports = app;