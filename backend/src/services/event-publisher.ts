import IORedis from 'ioredis';

const pubRedis = new (IORedis as any)(process.env.REDIS_URL || 'redis://localhost:6379');

/**
 * EventPublisher - 将事件发布到 Redis，供所有进程订阅
 * 这样可以在分布式部署中实现跨进程通信
 */
export class EventPublisher {
  /**
   * 发布账户更新事件
   */
  static async publishAccountUpdate(payload: any) {
    try {
      await pubRedis.publish('account:update', JSON.stringify(payload));
      console.log('[Redis] Published account:update:', payload);
    } catch (err) {
      console.error('[Redis] Failed to publish account:update:', err);
    }
  }

  /**
   * 发布任务更新事件
   */
  static async publishTaskUpdate(payload: any) {
    try {
      await pubRedis.publish('task:update', JSON.stringify(payload));
      console.log('[Redis] Published task:update:', payload);
    } catch (err) {
      console.error('[Redis] Failed to publish task:update:', err);
    }
  }

  /**
   * 发布影子环境切换事件（Shadow Failover）
   */
  static async publishShadowFailover(payload: any) {
    try {
      await pubRedis.publish('shadow:failover', JSON.stringify(payload));
      console.log('[Redis] Published shadow:failover:', payload);
    } catch (err) {
      console.error('[Redis] Failed to publish shadow:failover:', err);
    }
  }

  /**
   * 优雅关闭 Redis 连接
   */
  static async disconnect() {
    await pubRedis.quit();
  }
}
