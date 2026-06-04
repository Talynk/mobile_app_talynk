const Redis = require('ioredis');

const redisUrl = process.env.REDIS_URL || null;
const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = process.env.REDIS_PORT || 6379;
const redisPassword = process.env.REDIS_PASSWORD || undefined;

let client = null;
let isReady = false;

if (redisUrl || redisHost) {
  client = new Redis(redisUrl || {
    host: redisHost,
    port: Number(redisPort),
    password: redisPassword,
    lazyConnect: false,
  });

  client.on('ready', () => {
    isReady = true;
    console.log('[Redis] connected and ready');
  });

  client.on('error', (err) => {
    isReady = false;
    console.error('[Redis] connection error', err);
  });

  client.on('end', () => {
    isReady = false;
    console.warn('[Redis] connection closed');
  });
}

const getClient = () => client;
const redisReady = () => isReady && client;

module.exports = {
  getClient,
  redisReady,
};


