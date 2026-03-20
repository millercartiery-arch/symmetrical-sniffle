import { Worker, Job } from 'bullmq';
import { redisConnection } from './redis.js';
import { pool } from '../shared/db.js';
import { Cluster } from 'puppeteer-cluster';
import winston from 'winston';
import IORedis from 'ioredis';
import TextNowAutomation from '../services/textnow-automation.js';
import { decrypt } from '../shared/crypto.js';

const pubRedis = new (IORedis as any)(process.env.REDIS_URL || 'redis://localhost:6379');
const LOCK_RELEASE_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;
const LOCK_RENEW_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("EXPIRE", KEYS[1], ARGV[2])
else
  return 0
end
`;

const ACCOUNT_WORKER_LOCK_TTL_SECONDS = Number(process.env.ACCOUNT_WORKER_LOCK_TTL_SECONDS || 30);
const MAX_CONSECUTIVE_ERRORS = Number(process.env.MAX_CONSECUTIVE_ERRORS || 3);
const ACCOUNT_ISOLATION_STATUS = process.env.ACCOUNT_ISOLATION_STATUS || 'Cooldown';
const ENTROPY_PREPARE_BASE_MS = Number(process.env.ENTROPY_PREPARE_BASE_MS || 1500);
const ENTROPY_PREPARE_VARIANCE_MS = Number(process.env.ENTROPY_PREPARE_VARIANCE_MS || 800);
const ENTROPY_POST_SUCCESS_BASE_MS = Number(process.env.ENTROPY_POST_SUCCESS_BASE_MS || 2000);
const ENTROPY_POST_SUCCESS_VARIANCE_MS = Number(process.env.ENTROPY_POST_SUCCESS_VARIANCE_MS || 500);
let workerSchemaReady = false;

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  defaultMeta: { service: 'worker' },
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'worker.log' }),
  ],
});

type SendJobPayload = {
  taskId: number;
  accountId: number;
  sub_account_id?: number;
  targetPhone: string;
  content?: string | null;
  mediaUrl?: string | null;
  messageType?: string | null;
  proxyUrl?: string | null;
  proxyUsername?: string | null;
  proxyPassword?: string | null;
};

type FailureCategory = 'TCP_RST' | 'HTTP_429' | 'UNKNOWN';

let cluster: Cluster;
let clusterProxyKey = '';

const parseProxyUrl = (raw: unknown) => {
  const value = String(raw || '').trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return {
      server: `${parsed.protocol}//${parsed.hostname}:${parsed.port || (parsed.protocol === 'https:' ? '443' : '80')}`,
      username: decodeURIComponent(parsed.username || ''),
      password: decodeURIComponent(parsed.password || ''),
      key: `${parsed.protocol}//${parsed.hostname}:${parsed.port || ''}|${parsed.username}`,
    };
  } catch {
    return null;
  }
};

function getEntropyDelay(baseMs: number, varianceMs: number): number {
  const jitter = Math.floor(Math.random() * varianceMs * 2) - varianceMs;
  return Math.max(0, baseMs + jitter);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function updateMessageTask(taskId: number, fields: Record<string, string | number | Date | null | undefined>) {
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (!entries.length) return;

  const assignments = entries.map(([key]) => `${key} = ?`);
  const params = entries.map(([, value]) => value);
  const statements = [
    `UPDATE message_tasks SET ${assignments.join(', ')}, updated_at = NOW() WHERE id = ?`,
    `UPDATE message_tasks SET ${assignments.join(', ')} WHERE id = ?`,
  ];

  for (const sql of statements) {
    try {
      await pool.query(sql, [...params, taskId]);
      return;
    } catch (error: any) {
      if (sql === statements[statements.length - 1]) {
        throw error;
      }
    }
  }
}

async function ensureWorkerSchema() {
  if (workerSchemaReady) return;

  const alterStatements = [
    'ALTER TABLE accounts ADD COLUMN consecutive_errors INT NOT NULL DEFAULT 0',
    'ALTER TABLE accounts ADD COLUMN error_msg TEXT',
  ];

  for (const sql of alterStatements) {
    try {
      await pool.query(sql);
      logger.info(`Applied worker schema patch: ${sql}`);
    } catch (error: any) {
      if (error?.code !== 'ER_DUP_FIELDNAME') throw error;
    }
  }

  workerSchemaReady = true;
}

const accountLockKey = (accountId: number | string) => `lock:worker:account:${accountId}`;
const subAccountLockKey = (subAccountId: number | string) => `lock:worker:sub_account:${subAccountId}`;

async function acquireWorkerAccountLock(accountId: number | string, owner: string) {
  const lockResult = await pubRedis.set(
    accountLockKey(accountId),
    owner,
    'EX',
    ACCOUNT_WORKER_LOCK_TTL_SECONDS,
    'NX'
  );
  return lockResult === 'OK';
}

async function releaseWorkerAccountLock(accountId: number | string, owner: string) {
  await pubRedis.eval(LOCK_RELEASE_LUA, 1, accountLockKey(accountId), owner);
}

async function renewWorkerAccountLock(accountId: number | string, owner: string) {
  await pubRedis.eval(
    LOCK_RENEW_LUA,
    1,
    accountLockKey(accountId),
    owner,
    String(ACCOUNT_WORKER_LOCK_TTL_SECONDS)
  );
}

async function acquireWorkerSubAccountLock(subAccountId: number | string, owner: string) {
  const lockResult = await pubRedis.set(
    subAccountLockKey(subAccountId),
    owner,
    'EX',
    ACCOUNT_WORKER_LOCK_TTL_SECONDS,
    'NX'
  );
  return lockResult === 'OK';
}

async function releaseWorkerSubAccountLock(subAccountId: number | string, owner: string) {
  await pubRedis.eval(LOCK_RELEASE_LUA, 1, subAccountLockKey(subAccountId), owner);
}

async function renewWorkerSubAccountLock(subAccountId: number | string, owner: string) {
  await pubRedis.eval(
    LOCK_RENEW_LUA,
    1,
    subAccountLockKey(subAccountId),
    owner,
    String(ACCOUNT_WORKER_LOCK_TTL_SECONDS)
  );
}

function classifyFailure(error: any): FailureCategory {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  const status = Number(error?.status || error?.statusCode || error?.response?.status || 0);
  if (code === 'ECONNRESET' || message.includes('socket hang up') || message.includes('connection reset')) {
    return 'TCP_RST';
  }
  if (status === 429 || status === 403) {
    return 'HTTP_429';
  }
  return 'UNKNOWN';
}

type RollbackResult = {
  taskStatus: 'Pending' | 'Failed';
  accountStatus: string;
  consecutiveErrors: number;
};

async function releaseAndRollback(params: {
  taskId: number;
  accountId: number;
  sub_account_id?: number;
  retryable: boolean;
  errorType: FailureCategory;
  errorMessage: string;
}) {
  const { taskId, accountId, sub_account_id, retryable, errorType, errorMessage } = params;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const is429 = errorType === 'HTTP_429';
    const taskStatus: 'Pending' | 'Failed' = retryable ? 'Pending' : 'Failed';
    const errTruncated = errorMessage.substring(0, 1000);

    if (is429) {
      await conn.query(
        `UPDATE message_tasks
         SET status = 'Pending', error_msg = ?, locked_at = NULL,
             retry_at = DATE_ADD(NOW(), INTERVAL 60 SECOND), updated_at = NOW()
         WHERE id = ?`,
        [errTruncated, taskId]
      );
    } else {
      const taskParams = [taskStatus, errTruncated, retryable ? null : accountId, retryable ? null : sub_account_id ?? null, taskId];
      const statements = [
        `UPDATE message_tasks SET status = ?, error_msg = ?, locked_at = NULL, account_id = ?, sub_account_id = ?, retry_at = NULL, updated_at = NOW() WHERE id = ?`,
        `UPDATE message_tasks SET status = ?, error_msg = ?, locked_at = NULL, account_id = ?, updated_at = NOW() WHERE id = ?`,
      ];
      for (const sql of statements) {
        try {
          await conn.query(sql, sql.includes('sub_account_id') ? taskParams : [taskStatus, errTruncated, retryable ? null : accountId, taskId]);
          break;
        } catch (error: any) {
          if (sql === statements[statements.length - 1]) throw error;
        }
      }
    }

    if (sub_account_id != null) {
      await conn.query(
        `UPDATE sub_accounts SET is_busy = 0, locked_at = NULL, locked_by = NULL WHERE id = ?`,
        [sub_account_id]
      );
      await conn.commit();
      return {
        taskStatus,
        accountStatus: 'Ready',
        consecutiveErrors: 0,
      } as RollbackResult;
    }

    const shouldIncrement = errorType === 'TCP_RST' || errorType === 'HTTP_429';
    const isLoginFailed = /login\s*failed/i.test(errorMessage);
    let nextConsecutiveErrors = 0;
    let nextAccountStatus = 'Ready';

    if (isLoginFailed) {
      nextAccountStatus = ACCOUNT_ISOLATION_STATUS;
      await conn.query(
        `UPDATE accounts
         SET status = ?, error_msg = ?, locked_at = NULL, locked_by = NULL
         WHERE id = ?`,
        [nextAccountStatus, errorMessage, accountId]
      );
    } else if (shouldIncrement) {
      const [rows] = await conn.query(
        'SELECT COALESCE(consecutive_errors, 0) AS consecutive_errors FROM accounts WHERE id = ? FOR UPDATE',
        [accountId]
      ) as any[];
      const currentErrors = Number(rows?.[0]?.consecutive_errors || 0);
      nextConsecutiveErrors = currentErrors + 1;
      const shouldIsolate = nextConsecutiveErrors >= MAX_CONSECUTIVE_ERRORS;
      nextAccountStatus = shouldIsolate ? ACCOUNT_ISOLATION_STATUS : 'Ready';

      await conn.query(
        `UPDATE accounts
         SET consecutive_errors = ?,
             status = ?,
             error_msg = ?,
             locked_at = NULL,
             locked_by = NULL
         WHERE id = ?`,
        [nextConsecutiveErrors, nextAccountStatus, errorMessage, accountId]
      );
    } else {
      await conn.query(
        `UPDATE accounts
         SET status = 'Ready',
             error_msg = ?,
             locked_at = NULL,
             locked_by = NULL
         WHERE id = ?`,
        [errorMessage, accountId]
      );
    }

    await conn.commit();
    return {
      taskStatus,
      accountStatus: nextAccountStatus,
      consecutiveErrors: nextConsecutiveErrors,
    } as RollbackResult;
  } catch (error) {
    await conn.rollback();
    logger.error(`[Rollback Failed] task=${taskId} account=${accountId}`, error as any);
    throw error;
  } finally {
    conn.release();
  }
}

async function initCluster(proxyServer?: string) {
  logger.info('Initializing Puppeteer Cluster...');
  cluster = await Cluster.launch({
    concurrency: Cluster.CONCURRENCY_CONTEXT,
    maxConcurrency: 5,
    puppeteerOptions: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        ...(proxyServer ? [`--proxy-server=${proxyServer}`] : []),
      ],
    },
    monitor: false,
    timeout: 120000,
  });

  type ClusterPayload = SendJobPayload & {
    resolvedCredential?: { username: string; password: string; sessionCookie?: string; sessionId?: string };
  };

  await cluster.task(async ({ page, data }) => {
    const { accountId, targetPhone, content, mediaUrl, messageType, proxyUsername, proxyPassword, resolvedCredential } = data as ClusterPayload;
    const logId = resolvedCredential ? 'sub_account' : `account ${accountId}`;
    logger.info(`🚀 Processing REAL send task for ${logId} -> ${targetPhone}`);

    try {
      if (proxyUsername) {
        await page.authenticate({
          username: proxyUsername,
          password: String(proxyPassword || ''),
        });
        logger.info(`🔐 Proxy auth enabled for ${logId}`);
      }

      let username: string;
      let password: string;
      let sessionCookie = '';
      let sessionId = '';

      if (resolvedCredential) {
        username = resolvedCredential.username;
        password = resolvedCredential.password;
        sessionCookie = resolvedCredential.sessionCookie ?? '';
        sessionId = resolvedCredential.sessionId ?? '';
      } else {
        const [rows] = await pool.query('SELECT * FROM accounts WHERE id = ?', [accountId]) as any[];
        if (!rows.length) throw new Error(`Account ${accountId} not found`);
        const account = rows[0];
        username = account.username;
        password = account.password;
        sessionCookie =
          account.tn_session_token_cipher && Buffer.isBuffer(account.tn_session_token_cipher)
            ? decrypt(account.tn_session_token_cipher)
            : account.tn_session_token_cipher
              ? decrypt(Buffer.from(account.tn_session_token_cipher))
              : '';
        sessionId = String(account.tn_session_id || '');
      }

      const automation = new TextNowAutomation(page);
      const result = await automation.executeFullFlow({
        username,
        password,
        targetPhone,
        message: typeof content === 'string' ? content : '',
        mediaUrl: typeof mediaUrl === 'string' ? mediaUrl : '',
        messageType: String(messageType || '').trim() === 'image' || mediaUrl ? 'image' : 'text',
        sessionCookie: typeof sessionCookie === 'string' ? sessionCookie : '',
        sessionId,
      });

      if (!result.success) {
        throw new Error(result.error || 'Unknown error in TextNow automation');
      }

      logger.info(`✅ REAL message sent successfully via TextNow!`);
      return { success: true, messageId: `tn-${Date.now()}` };
    } catch (error: any) {
      logger.error(`❌ REAL TextNow automation failed: ${error.message}`);
      throw error;
    }
  });

  logger.info('Puppeteer Cluster ready.');
}

const worker = new Worker('tn-send', async (job: Job) => {
  const { taskId, accountId, sub_account_id, targetPhone, content, mediaUrl, messageType, proxyUrl } = job.data as SendJobPayload;
  await ensureWorkerSchema();

  const owner = `worker:${process.pid}:task:${taskId}:job:${String(job.id || '')}`;
  let lockAcquired = false;
  let lockHeartbeat: NodeJS.Timeout | null = null;
  const retryableAttempts = Number((job.opts as any)?.attempts || 1);
  const normalizedProxyUrl = String(proxyUrl || '').trim();
  if (!normalizedProxyUrl) {
    throw new Error(`Missing proxyUrl, skip to avoid unstable egress`);
  }
  const proxyConfig = parseProxyUrl(normalizedProxyUrl);
  if (!proxyConfig) {
    throw new Error(`Invalid proxyUrl`);
  }

  if (!cluster || clusterProxyKey !== (proxyConfig?.key || '')) {
    if (cluster) {
      logger.info(`♻️ Reinitializing cluster for proxy key ${proxyConfig?.key || 'direct'}`);
      await cluster.close();
    }
    await initCluster(proxyConfig?.server);
    clusterProxyKey = proxyConfig?.key || '';
  }

  let resolvedCredential: { username: string; password: string; sessionCookie: string; sessionId: string } | undefined;
  if (sub_account_id) {
    const [rows] = await pool.query(
      `SELECT c.username, c.password_cipher FROM sub_accounts s
       INNER JOIN credentials c ON c.id = s.credential_id WHERE s.id = ?`,
      [sub_account_id]
    ) as any[];
    if (!rows?.length) throw new Error(`Sub-account ${sub_account_id} or credential not found`);
    const cred = rows[0];
    const password = cred.password_cipher
      ? (Buffer.isBuffer(cred.password_cipher)
          ? decrypt(cred.password_cipher)
          : decrypt(Buffer.from(cred.password_cipher)))
      : '';
    resolvedCredential = {
      username: String(cred.username || ''),
      password: typeof password === 'string' ? password : '',
      sessionCookie: '',
      sessionId: '',
    };
  }

  const lockId = sub_account_id ?? accountId;
  const acquireLock = sub_account_id ? () => acquireWorkerSubAccountLock(sub_account_id, owner) : () => acquireWorkerAccountLock(accountId, owner);
  const releaseLock = sub_account_id ? () => releaseWorkerSubAccountLock(sub_account_id, owner) : () => releaseWorkerAccountLock(accountId, owner);
  const renewLock = sub_account_id ? () => renewWorkerSubAccountLock(sub_account_id, owner) : () => renewWorkerAccountLock(accountId, owner);

  try {
    lockAcquired = await acquireLock();
    if (!lockAcquired) {
      const lockError = new Error(`${sub_account_id ? 'Sub-account' : 'Account'} ${lockId} lock not acquired by worker`);
      (lockError as any).code = 'ACCOUNT_LOCKED';
      throw lockError;
    }
    const heartbeatMs = Math.max(1000, Math.floor((ACCOUNT_WORKER_LOCK_TTL_SECONDS * 1000) / 3));
    lockHeartbeat = setInterval(() => {
      renewLock().catch((error: any) => {
        logger.warn(`Failed to renew worker lock for ${lockId}: ${error?.message || error}`);
      });
    }, heartbeatMs);

    await updateMessageTask(taskId, {
      status: 'Processing',
      error_msg: null,
      account_id: sub_account_id ? null : accountId,
      locked_at: new Date(),
    });
    pubRedis.publish('task:update', JSON.stringify({
      taskId,
      status: 'Processing',
      progress: 0,
      timestamp: Date.now(),
    }));

    await sleep(getEntropyDelay(ENTROPY_PREPARE_BASE_MS, ENTROPY_PREPARE_VARIANCE_MS));

    await cluster.execute({
      taskId,
      accountId: sub_account_id ? 0 : accountId,
      sub_account_id,
      targetPhone,
      content: typeof content === 'string' ? content : '',
      mediaUrl: typeof mediaUrl === 'string' ? mediaUrl : '',
      messageType: typeof messageType === 'string' ? messageType : '',
      proxyUsername: proxyConfig?.username || '',
      proxyPassword: proxyConfig?.password || '',
      resolvedCredential,
    });

    await sleep(getEntropyDelay(ENTROPY_POST_SUCCESS_BASE_MS, ENTROPY_POST_SUCCESS_VARIANCE_MS));

    await updateMessageTask(taskId, {
      status: 'Sent',
      error_msg: null,
      locked_at: null,
    });
    if (sub_account_id) {
      await pool.query(
        `UPDATE sub_accounts SET
           rate_counter = CASE WHEN rate_reset_at IS NULL OR rate_reset_at <= NOW() THEN 1 ELSE rate_counter + 1 END,
           rate_reset_at = CASE WHEN rate_reset_at IS NULL OR rate_reset_at <= NOW() THEN DATE_ADD(NOW(), INTERVAL COALESCE(rate_window_sec, 300) SECOND) ELSE rate_reset_at END,
           is_busy = 0, locked_at = NULL, locked_by = NULL
         WHERE id = ?`,
        [sub_account_id]
      ).catch(() => undefined);
    } else {
      await pool.query(
        `UPDATE accounts
         SET last_used_at = NOW(),
             status = 'Ready',
             locked_at = NULL,
             locked_by = NULL,
             consecutive_errors = 0,
             error_msg = NULL
         WHERE id = ?`,
        [accountId]
      ).catch(() => undefined);
    }
    logger.info(`✅ Task ${taskId} marked as Sent`);

    pubRedis.publish('task:update', JSON.stringify({
      taskId,
      status: 'Sent',
      progress: 100,
      timestamp: Date.now(),
    }));
    pubRedis.publish('account:update', JSON.stringify({
      id: lockId,
      status: 'Ready',
      sub: !!sub_account_id,
    }));
  } catch (err: any) {
    logger.error(`❌ Task ${taskId} failed: ${err.message}`);

    const retryable = job.attemptsMade < retryableAttempts;
    const errorCategory = classifyFailure(err);
    const errorMsg = String(err.message || 'Unknown worker error').substring(0, 1000);
    const rollbackResult = await releaseAndRollback({
      taskId,
      accountId: sub_account_id ? 0 : accountId,
      sub_account_id: sub_account_id ?? undefined,
      retryable,
      errorType: errorCategory,
      errorMessage: errorMsg,
    });

    pubRedis.publish('task:update', JSON.stringify({
      taskId,
      status: rollbackResult.taskStatus,
      error_msg: errorMsg,
      timestamp: Date.now(),
    }));
    pubRedis.publish('account:update', JSON.stringify({
      id: lockId,
      status: rollbackResult.accountStatus,
      consecutive_errors: rollbackResult.consecutiveErrors,
      timestamp: Date.now(),
    }));

    logger.warn(
      `↩️ Task ${taskId} rollback to ${rollbackResult.taskStatus}; ${sub_account_id ? 'sub_account' : 'account'} ${lockId} -> ${rollbackResult.accountStatus} (${errorCategory})`
    );

    throw err;
  } finally {
    if (lockHeartbeat) {
      clearInterval(lockHeartbeat);
      lockHeartbeat = null;
    }
    if (lockAcquired) {
      try {
        await releaseLock();
      } catch (releaseError: any) {
        logger.warn(`Failed to release worker lock for ${lockId}: ${releaseError?.message || releaseError}`);
      }
    }
  }
}, {
  connection: redisConnection,
  concurrency: 5,
});

worker.on('completed', (job) => {
  logger.info(`Job ${job.id} completed!`);
});

worker.on('failed', (job, err) => {
  logger.error(`Job ${job?.id} failed: ${err.message}`);
});

logger.info('Worker started and listening on tn-send...');
