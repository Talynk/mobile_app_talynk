const prisma = require('../lib/prisma');

const POST_REPORT_SUSPEND_THRESHOLD_KEY = 'post_report_suspend_threshold';
const DEFAULT_POST_REPORT_SUSPEND_THRESHOLD = 5;
const MIN_POST_REPORT_SUSPEND_THRESHOLD = 1;
const MAX_POST_REPORT_SUSPEND_THRESHOLD = 1000;

const toSafeThreshold = (rawValue, fallback = DEFAULT_POST_REPORT_SUSPEND_THRESHOLD) => {
    const parsed = Number.parseInt(rawValue, 10);
    if (!Number.isInteger(parsed)) {
        return fallback;
    }

    return Math.min(
        MAX_POST_REPORT_SUSPEND_THRESHOLD,
        Math.max(MIN_POST_REPORT_SUSPEND_THRESHOLD, parsed)
    );
};

const getPostReportSuspendThreshold = async () => {
    const setting = await prisma.appSetting.findUnique({
        where: { key: POST_REPORT_SUSPEND_THRESHOLD_KEY },
        select: { value: true }
    });

    return toSafeThreshold(setting?.value);
};

const setPostReportSuspendThreshold = async (value) => {
    const normalized = toSafeThreshold(value, NaN);
    if (!Number.isInteger(normalized)) {
        throw new Error('Post report suspend threshold must be a valid integer');
    }

    const saved = await prisma.appSetting.upsert({
        where: { key: POST_REPORT_SUSPEND_THRESHOLD_KEY },
        update: {
            value: String(normalized),
            description: 'Number of reports required to auto-suspend a post'
        },
        create: {
            key: POST_REPORT_SUSPEND_THRESHOLD_KEY,
            value: String(normalized),
            description: 'Number of reports required to auto-suspend a post'
        },
        select: { value: true }
    });

    return toSafeThreshold(saved.value);
};

module.exports = {
    POST_REPORT_SUSPEND_THRESHOLD_KEY,
    DEFAULT_POST_REPORT_SUSPEND_THRESHOLD,
    MIN_POST_REPORT_SUSPEND_THRESHOLD,
    MAX_POST_REPORT_SUSPEND_THRESHOLD,
    getPostReportSuspendThreshold,
    setPostReportSuspendThreshold
};
