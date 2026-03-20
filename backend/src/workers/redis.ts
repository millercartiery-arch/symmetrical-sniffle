import IORedis from 'ioredis';

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');
const REDIS_PASSWORD = process.env.REDIS_PASSWORD;

/** Stop reconnecting after first failure in dev when Redis is not running (avoids log flood). */
const retryStrategy = process.env.DEBUG_REDIS === 'true'
  ? undefined
  : () => null;

export const redisConnection = new (IORedis as any)({
  host: REDIS_HOST,
  port: REDIS_PORT,
  password: REDIS_PASSWORD,
  maxRetriesPerRequest: null,
  retryStrategy,
  lazyConnect: true,
});

redisConnection.on('error', (err) => {
  if (process.env.DEBUG_REDIS === 'true') {
    console.error('Redis connection error:', err);
  }
});
