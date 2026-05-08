const Sentry = require("@sentry/node");

const pkg = require("../package.json");
const isProduction = process.env.NODE_ENV === "production";

const SENSITIVE_ATTR_KEYS = ["password", "token", "authorization", "cookie", "secret"];

function stripSensitiveAttributes(attributes) {
  if (!attributes || typeof attributes !== "object") return attributes;
  const out = { ...attributes };
  for (const key of Object.keys(out)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_ATTR_KEYS.some((s) => lower.includes(s))) {
      delete out[key];
    }
  }
  return out;
}

Sentry.init({
  dsn:
    process.env.SENTRY_DSN ||
    "https://0ada0844417b3a95b9fa5cb6b3b090da@o4510978923692032.ingest.de.sentry.io/4510978933129296",
  environment: process.env.NODE_ENV || "development",
  sendDefaultPii: true,

  release: process.env.SENTRY_RELEASE || pkg.version,

  enableLogs: true,

  tracesSampleRate: isProduction ? 0.1 : 1.0,

  tracePropagationTargets: [
    "localhost",
    "127.0.0.1",
    /^https:\/\/(.*\.)?(talynk\.|talentix\.|vercel\.app|railway\.app)/,
  ],

  strictTraceContinuation: true,

  integrations: [
    Sentry.consoleLoggingIntegration({ levels: ["log", "warn", "error"] }),
  ],

  beforeSendLog(log) {
    if (log.level === "debug" && isProduction) {
      return null;
    }
    if (log.attributes) {
      log.attributes = stripSensitiveAttributes(log.attributes);
    }
    return log;
  },

  beforeSendSpan(span) {
    span.data = {
      ...span.data,
      "app.version": pkg.version,
      "environment.region": process.env.AWS_REGION || process.env.REGION || "",
    };
    return span;
  },
});
