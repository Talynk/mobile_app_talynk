const winston = require('winston');
require('winston-daily-rotate-file');

// Create custom format
const customFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

// Create different transports
const transports = {
    // Error logs
    error: new winston.transports.DailyRotateFile({
        filename: 'logs/error-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxFiles: '30d'
    }),

    // Access logs
    access: new winston.transports.DailyRotateFile({
        filename: 'logs/access-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        maxFiles: '30d'
    }),

    // Debug logs (development only)
    debug: new winston.transports.DailyRotateFile({
        filename: 'logs/debug-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        level: 'debug',
        maxFiles: '7d'
    }),

    // Console output (development only)
    console: new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    })
};

// Create loggers
const logger = winston.createLogger({
    format: customFormat,
    transports: [
        transports.error,
        transports.access
    ]
});

// Add console transport in development
if (process.env.NODE_ENV !== 'production') {
    logger.add(transports.console);
    logger.add(transports.debug);
}

// Create specific logging functions
exports.loggers = {
    error: (err, req = null) => {
        const logData = {
            error: {
                message: err.message,
                stack: err.stack
            },
            timestamp: new Date().toISOString()
        };

        if (req) {
            logData.request = {
                method: req.method,
                url: req.url,
                headers: req.headers,
                body: req.body,
                ip: req.ip
            };
        }

        logger.error(logData);
    },

    access: (req, res, responseTime) => {
        const userAgent = req.get('user-agent') || '';
        
        // Extract device information from user agent
        const deviceInfo = {
            isMobile: /mobile|android|iphone|ipod|blackberry|iemobile|opera mini/i.test(userAgent),
            isTablet: /tablet|ipad|playbook|silk/i.test(userAgent),
            isDesktop: !/mobile|android|iphone|ipod|blackberry|iemobile|opera mini|tablet|ipad|playbook|silk/i.test(userAgent),
            browser: userAgent.includes('Chrome') ? 'Chrome' : 
                    userAgent.includes('Firefox') ? 'Firefox' : 
                    userAgent.includes('Safari') ? 'Safari' : 
                    userAgent.includes('Edge') ? 'Edge' : 'Other',
            os: userAgent.includes('Windows') ? 'Windows' : 
                userAgent.includes('Mac') ? 'Mac' : 
                userAgent.includes('Linux') ? 'Linux' : 
                userAgent.includes('Android') ? 'Android' : 
                userAgent.includes('iOS') ? 'iOS' : 'Other'
        };

        logger.info({
            type: 'access',
            timestamp: new Date().toISOString(),
            method: req.method,
            url: req.url,
            status: res.statusCode,
            responseTime,
            ip: req.ip,
            userAgent,
            deviceInfo
        });
    },

    audit: (action, user, details) => {
        logger.info({
            type: 'audit',
            timestamp: new Date().toISOString(),
            action,
            user,
            details
        });
    },

    debug: (message, data = {}) => {
        if (process.env.NODE_ENV !== 'production') {
            logger.debug({
                message,
                data,
                timestamp: new Date().toISOString()
            });
        }
    }
}; 