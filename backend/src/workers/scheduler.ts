
import { Queue } from 'bullmq';
import { redisConnection } from './redis.js';
import { pool } from '../shared/db.js';
import { ensureProxySchema } from '../shared/proxy-schema.js';
import { ensureCardCredentialSchema } from '../shared/card-credential-schema.js';
import winston from 'winston';
import IORedis from 'ioredis';

const pubRedis = new (IORedis as any)(process.env.REDIS_URL || 'redis://localhost:6379');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  defaultMeta: { service: 'scheduler' },
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'scheduler.log' }),
  ],
});

const TASK_QUEUE_NAME = 'tn-send';
export const taskQueue = new Queue(TASK_QUEUE_NAME, { connection: redisConnection });
const ACCOUNT_LOCK_TIMEOUT_MINUTES = 5;
const TASK_LOCK_TIMEOUT_MINUTES = 5;
const ACCOUNT_REDIS_LOCK_TTL_MS = 90 * 1000;
const ENABLE_TEMPORAL_ENTROPY = process.env.ENABLE_TEMPORAL_ENTROPY !== 'false';
const LOCK_RELEASE_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;
let schedulerSchemaReady = false;
let dispatchInFlight = false;
const temporalCursorByCampaignMs = new Map<number, number>();

const accountLockKey = (accountId: number | string) => `lock:account:${accountId}`;
const subAccountLockKey = (subAccountId: number | string) => `lock:account:sub:${subAccountId}`;
const lockOwner = (taskId: number | string) => `scheduler:${process.pid}:task:${taskId}`;
const parseAllowedAccountIds = (raw: unknown): number[] => {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0);
  } catch {
    return [];
  }
};

const buildSessionizedProxyUrl = (rawProxyUrl: string, sessionKey: string): string => {
  const value = String(rawProxyUrl || "").trim();
  if (!value) return value;
  try {
    const parsed = new URL(value);
    const normalizedSession = String(sessionKey || "").trim() || "default";

    if (parsed.username) {
      const username = decodeURIComponent(parsed.username);
      if (username.includes("{session}")) {
        parsed.username = username.replaceAll("{session}", normalizedSession);
      } else if (/(sess(?:ion)?[-_:]?)([a-z0-9]+)/i.test(username)) {
        parsed.username = username.replace(/(sess(?:ion)?[-_:]?)([a-z0-9]+)/i, `$1${normalizedSession}`);
      } else {
        parsed.username = `${username}-session-${normalizedSession}`;
      }
    } else {
      parsed.searchParams.set("session", normalizedSession);
    }
    return parsed.toString();
  } catch {
    return value;
  }
};

const normalizeAccountSessionKey = (
  accountId: number | string,
  rawSessionKey: unknown,
  proxyId?: number | string
): string => {
  const preferred = String(rawSessionKey || "").trim();
  const fallback = `acc-${String(accountId)}`;
  const base = preferred || fallback;
  const normalized = base.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80) || fallback;
  if (!proxyId) return normalized;
  return `${normalized}-p${String(proxyId)}`.slice(0, 96);
};

async function resolveProxyUrlForAccount(conn: any, accountId: number | string) {
  const [bindingRows] = await conn.query(
    `SELECT p.id,
            p.protocol,
            p.host,
            p.port,
            p.username,
            p.password,
            p.proxy_url_template,
            ap.session_key
     FROM account_proxy_bindings ap
     INNER JOIN proxies p ON p.id = ap.proxy_id
     WHERE ap.account_id = ?
       AND ap.is_active = 1
       AND p.is_active = 1
     ORDER BY ap.is_primary DESC, ap.id ASC
     LIMIT 1`,
    [accountId]
  ) as any[];

  const binding = bindingRows?.[0];
  if (binding) {
    const template = String(binding.proxy_url_template || "").trim();
    const base =
      template ||
      `${String(binding.protocol || "http")}://${binding.username ? `${binding.username}:${binding.password || ""}@` : ""}${binding.host}:${binding.port}`;
    const sessionKey = normalizeAccountSessionKey(accountId, binding.session_key, binding.id);
    return buildSessionizedProxyUrl(base, sessionKey);
  }

  const [accountRows] = await conn.query("SELECT proxy_url FROM accounts WHERE id = ?", [accountId]) as any[];
  const accountProxy = String(accountRows?.[0]?.proxy_url || "").trim();
  if (!accountProxy) return "";
  return buildSessionizedProxyUrl(accountProxy, `acc-${accountId}`);
}

async function resolveProxyUrlForSubAccount(conn: any, subAccountId: number | string): Promise<string> {
  const { decryptProxyPassword } = await import('../shared/crypto.js');
  const [rows] = await conn.query(
    `SELECT s.proxy_id, p.protocol, p.host, p.port, p.username, p.password, p.auth_pass_enc, p.proxy_url_template
     FROM sub_accounts s
     LEFT JOIN proxies p ON p.id = s.proxy_id AND p.is_active = 1
     WHERE s.id = ?`,
    [subAccountId]
  ) as any[];
  const row = rows?.[0];
  if (!row?.proxy_id) return "";
  const template = String(row.proxy_url_template || "").trim();
  const plainPass = row.password != null && row.password !== '' ? String(row.password) : decryptProxyPassword(row.auth_pass_enc);
  const base =
    template ||
    `${String(row.protocol || "http")}://${row.username ? `${encodeURIComponent(row.username)}:${encodeURIComponent(plainPass || "")}@` : ""}${row.host}:${row.port}`;
  const sessionKey = `sub-${subAccountId}`;
  return buildSessionizedProxyUrl(base, sessionKey);
}

const samplePoissonIntervalSeconds = (minSeconds: number, maxSeconds: number): number => {
  const lower = Math.max(1, Math.floor(Number(minSeconds || 0)));
  const upper = Math.max(lower, Math.floor(Number(maxSeconds || minSeconds || 0)));
  const mean = (lower + upper) / 2;
  // Exponential inter-arrival sampling to approximate Poisson process intervals.
  const u = Math.max(1 - Math.random(), Number.EPSILON);
  const sampled = Math.round(-Math.log(u) * mean);
  return Math.min(upper, Math.max(lower, sampled));
};

const setCampaignTemporalCursor = (campaignId: number, cursorMs: number) => {
  if (campaignId <= 0) return;
  temporalCursorByCampaignMs.set(campaignId, cursorMs);
  // Keep memory bounded for long-running schedulers.
  if (temporalCursorByCampaignMs.size > 2000) {
    const oldest = temporalCursorByCampaignMs.keys().next().value;
    if (typeof oldest === "number") {
      temporalCursorByCampaignMs.delete(oldest);
    }
  }
};

async function scheduleTaskAt(conn: any, taskId: number | string, scheduledAt: Date) {
  const statements = [
    `UPDATE message_tasks
     SET scheduled_at = ?,
         updated_at = NOW()
     WHERE id = ?
       AND status IN ('Pending', 'PENDING')
       AND scheduled_at IS NULL`,
    `UPDATE message_tasks
     SET scheduled_at = ?
     WHERE id = ?
       AND status IN ('Pending', 'PENDING')
       AND scheduled_at IS NULL`,
  ];
  for (const sql of statements) {
    try {
      const [result]: any = await conn.query(sql, [scheduledAt, taskId]);
      return Number(result?.affectedRows || 0) === 1;
    } catch (error: any) {
      if (sql === statements[statements.length - 1]) throw error;
    }
  }
  return false;
}

async function ensureSchedulerSchema(conn: any) {
  if (schedulerSchemaReady) return;
  await ensureProxySchema(conn);
  await ensureCardCredentialSchema(conn);

  const alterStatements = [
    "ALTER TABLE message_tasks ADD COLUMN sub_account_id BIGINT UNSIGNED NULL",
    "ALTER TABLE message_tasks ADD COLUMN locked_at TIMESTAMP NULL",
    "ALTER TABLE message_tasks ADD COLUMN scheduled_at TIMESTAMP NULL",
    "ALTER TABLE message_tasks ADD COLUMN error_msg VARCHAR(255) NULL",
    "ALTER TABLE message_tasks ADD COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
    "ALTER TABLE message_tasks ADD COLUMN retry_at DATETIME NULL",
    "ALTER TABLE accounts ADD COLUMN rate_limit INT DEFAULT 300",
    "ALTER TABLE accounts ADD COLUMN rate_window_sec INT DEFAULT 300",
    "ALTER TABLE accounts ADD COLUMN rate_counter INT DEFAULT 0",
    "ALTER TABLE accounts ADD COLUMN rate_reset_at DATETIME NULL",
  ];

  for (const sql of alterStatements) {
    try {
      await conn.query(sql);
      logger.info(`Applied scheduler schema patch: ${sql}`);
    } catch (error: any) {
      if (error?.code !== 'ER_DUP_FIELDNAME') throw error;
    }
  }

  try {
    await conn.query("ALTER TABLE message_tasks MODIFY COLUMN media_url MEDIUMTEXT NULL");
  } catch (error: any) {
    if (error?.code !== 'ER_BAD_FIELD_ERROR') throw error;
  }

  try {
    await conn.query("ALTER TABLE message_tasks MODIFY COLUMN error_msg TEXT NULL");
  } catch (error: any) {
    if (error?.code !== 'ER_BAD_FIELD_ERROR') throw error;
  }

  const indexStatements = [
    "CREATE INDEX idx_message_tasks_status_schedule ON message_tasks (status, scheduled_at, created_at)",
    "CREATE INDEX idx_message_tasks_lock_state ON message_tasks (status, locked_at)",
    "CREATE INDEX idx_message_tasks_sub_status ON message_tasks (sub_account_id, status)",
    "CREATE INDEX idx_accounts_status_lock_state ON accounts (status, locked_at, last_used_at)",
  ];

  for (const sql of indexStatements) {
    try {
      await conn.query(sql);
      logger.info(`Applied scheduler index patch: ${sql}`);
    } catch (error: any) {
      if (error?.code !== 'ER_DUP_KEYNAME' && error?.code !== 'ER_TOO_LONG_KEY') throw error;
    }
  }

  schedulerSchemaReady = true;
}

async function releaseStaleLocks(conn: any) {
  const [taskRelease]: any = await conn.query(
    `UPDATE message_tasks
     SET status = 'Pending',
         locked_at = NULL,
         retry_at = NULL
     WHERE status IN ('LOCKED', 'Processing')
       AND locked_at IS NOT NULL
       AND locked_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
    [TASK_LOCK_TIMEOUT_MINUTES]
  );

  const [accountRelease]: any = await conn.query(
    `UPDATE accounts
     SET status = 'Ready',
         locked_at = NULL,
         locked_by = NULL
     WHERE status = 'Busy'
       AND locked_at IS NOT NULL
       AND locked_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
    [ACCOUNT_LOCK_TIMEOUT_MINUTES]
  );

  try {
    await conn.query(
      `UPDATE sub_accounts
       SET is_busy = 0, locked_at = NULL, locked_by = NULL
       WHERE is_busy = 1
         AND locked_at IS NOT NULL
         AND locked_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
      [ACCOUNT_LOCK_TIMEOUT_MINUTES]
    );
  } catch (e: any) {
    if (e?.code !== 'ER_BAD_FIELD_ERROR') logger.warn('Release sub_accounts stale lock', e?.message);
  }

  const releasedTasks = Number(taskRelease?.affectedRows || 0);
  const releasedAccounts = Number(accountRelease?.affectedRows || 0);
  if (releasedTasks || releasedAccounts) {
    logger.warn(`Released stale runtime locks: tasks=${releasedTasks}, accounts=${releasedAccounts}`);
  }
}

async function fetchPendingTasks(conn: any) {
  const withScheduleSql = `SELECT t.*,
              c.tn_account_ids AS campaign_tn_account_ids,
              c.min_interval AS campaign_min_interval,
              c.max_interval AS campaign_max_interval
       FROM message_tasks t
       LEFT JOIN campaigns c ON c.id = t.campaign_id
       WHERE t.status IN ('Pending', 'PENDING')
       AND (t.scheduled_at <= NOW() OR t.scheduled_at IS NULL)
       AND (t.retry_at IS NULL OR t.retry_at <= NOW())
       ORDER BY t.created_at ASC
       LIMIT 50
       FOR UPDATE SKIP LOCKED`;

  try {
    const [tasks] = await conn.query(withScheduleSql);
    return tasks as any[];
  } catch (error: any) {
    if (error?.code !== 'ER_BAD_FIELD_ERROR' && error?.code !== 'ER_PARSE_ERROR') {
      throw error;
    }
    logger.warn('Pending-task schema is partially missing; falling back to legacy pending-task query');
    const fallbackSql = `SELECT t.*, c.tn_account_ids AS campaign_tn_account_ids
       FROM message_tasks t
       LEFT JOIN campaigns c ON c.id = t.campaign_id
       WHERE t.status IN ('Pending', 'PENDING')
       AND (t.scheduled_at <= NOW() OR t.scheduled_at IS NULL)
       ORDER BY t.created_at ASC
       LIMIT 50
       FOR UPDATE`;
    const [tasks] = await conn.query(fallbackSql);
    return tasks as any[];
  }
}

async function acquireAccountRedisLock(accountId: number | string, owner: string) {
  const lockResult = await pubRedis.set(
    accountLockKey(accountId),
    owner,
    'PX',
    ACCOUNT_REDIS_LOCK_TTL_MS,
    'NX'
  );
  return lockResult === 'OK';
}

async function releaseAccountRedisLock(accountId: number | string, owner: string) {
  await pubRedis.eval(LOCK_RELEASE_LUA, 1, accountLockKey(accountId), owner);
}

async function releaseRedisLock(key: string, owner: string) {
  await pubRedis.eval(LOCK_RELEASE_LUA, 1, key, owner);
}

async function acquireSubAccountRedisLock(subAccountId: number | string, owner: string) {
  const lockResult = await pubRedis.set(
    subAccountLockKey(subAccountId),
    owner,
    'PX',
    ACCOUNT_REDIS_LOCK_TTL_MS,
    'NX'
  );
  return lockResult === 'OK';
}

async function transitionTaskToLocked(
  conn: any,
  taskId: number | string,
  opts: { accountId?: number | string; subAccountId?: number | string }
) {
  const { accountId, subAccountId } = opts;
  const [result]: any = await conn.query(
    `UPDATE message_tasks
     SET status = 'LOCKED',
         account_id = ?,
         sub_account_id = ?,
         locked_at = NOW()
     WHERE id = ?
       AND status IN ('Pending', 'PENDING')`,
    [accountId ?? null, subAccountId ?? null, taskId]
  );
  return Number(result?.affectedRows || 0) === 1;
}

export async function dispatchPending() {
  if (dispatchInFlight) {
    logger.warn('Previous dispatch cycle still running; skip this tick');
    return;
  }
  dispatchInFlight = true;

  if (redisConnection.status !== 'ready') {
    logger.warn('Redis not ready, skipping dispatch');
    dispatchInFlight = false;
    return;
  }

  const conn = await pool.getConnection();
  const redisLocks: Array<{ key: string; owner: string }> = [];
  try {
    await conn.beginTransaction();
    await ensureSchedulerSchema(conn);
    await releaseStaleLocks(conn);

    // 1. Fetch pending tasks. Older deployed schemas may not have scheduled_at yet.
    const tasks = await fetchPendingTasks(conn);

    if (tasks.length === 0) {
      await conn.commit();
      return;
    }

    logger.info(`Found ${tasks.length} pending tasks`);

    for (const task of tasks) {
      if (ENABLE_TEMPORAL_ENTROPY && !task.scheduled_at) {
        const minIntervalSeconds = Math.max(0, Number(task.campaign_min_interval || 0));
        const maxIntervalSeconds = Math.max(minIntervalSeconds, Number(task.campaign_max_interval || minIntervalSeconds));
        if (maxIntervalSeconds > 0) {
          const campaignId = Number(task.campaign_id || 0);
          const cursorBaseMs = campaignId > 0
            ? (temporalCursorByCampaignMs.get(campaignId) || Date.now())
            : Date.now();
          const delaySeconds = samplePoissonIntervalSeconds(minIntervalSeconds, maxIntervalSeconds);
          const scheduledMs = cursorBaseMs + delaySeconds * 1000;
          const scheduledAt = new Date(scheduledMs);
          setCampaignTemporalCursor(campaignId, scheduledMs);
          const scheduled = await scheduleTaskAt(conn, task.id, scheduledAt);
          if (scheduled) {
            logger.info(
              `Entropy scheduled task ${task.id} at ${scheduledAt.toISOString()} (+${delaySeconds}s, campaign=${campaignId || 'n/a'})`
            );
            continue;
          }
        }
      }

      let accountId = task.account_id;
      let subAccountId: number | string | null = task.sub_account_id || null;
      const taskTenantId = Number(task.tenant_id || 1);
      const allowedAccountIds = parseAllowedAccountIds(task.campaign_tn_account_ids);

      // 2. Prefer sub_account (card-key activated) when no account assigned
      if (!accountId && !subAccountId) {
        const [subRows]: any = await conn.query(
          `SELECT s.id FROM sub_accounts s
           LEFT JOIN card_keys k ON k.id = s.card_key_id
           WHERE s.tenant_id = ? AND s.status = 'ready' AND s.is_busy = 0 AND s.enabled = 1
             AND (s.card_key_id IS NULL OR k.status IN ('active', 'used'))
           ORDER BY s.weight DESC, s.id ASC
           LIMIT 1 FOR UPDATE`,
          [taskTenantId]
        );
        if (subRows?.length) {
          subAccountId = subRows[0].id;
        }
      }

      let proxyUrl = '';
      if (subAccountId) {
        proxyUrl = await resolveProxyUrlForSubAccount(conn, subAccountId);
        if (!proxyUrl) {
          logger.warn(`No proxy for sub_account=${subAccountId}, skip task=${task.id}`);
          subAccountId = null;
        }
      }

      // Fallback to legacy account when no sub_account or no proxy
      if (!subAccountId) {
        if (!accountId) {
          let accountSql = `SELECT id FROM accounts
               WHERE status = 'Ready'
               AND tenant_id = ?
               AND (locked_at IS NULL OR locked_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE))`;
          const accountParams: any[] = [taskTenantId];
          if (allowedAccountIds.length > 0) {
            accountSql += ` AND id IN (${allowedAccountIds.map(() => '?').join(',')})`;
            accountParams.push(...allowedAccountIds);
          }
          accountSql += ` ORDER BY last_used_at ASC LIMIT 1 FOR UPDATE`;
          const [accounts] = await conn.query(accountSql, accountParams) as any[];

          if (accounts.length === 0) {
            logger.warn(`No available accounts for task ${task.id}, tenant=${taskTenantId}, allowed=${allowedAccountIds.join(',') || 'ALL'}`);
            continue;
          }
          accountId = accounts[0].id;
        } else {
          let assignedSql = `SELECT id FROM accounts
               WHERE id = ? AND status = 'Ready' AND tenant_id = ?`;
          const assignedParams: any[] = [accountId, taskTenantId];
          if (allowedAccountIds.length > 0) {
            assignedSql += ` AND id IN (${allowedAccountIds.map(() => '?').join(',')})`;
            assignedParams.push(...allowedAccountIds);
          }
          assignedSql += ` FOR UPDATE`;
          const [accounts] = await conn.query(assignedSql, assignedParams) as any[];
          if (accounts.length === 0) {
            logger.warn(`Assigned account ${accountId} for task ${task.id} is not ready/available in tenant=${taskTenantId}`);
            continue;
          }
        }
        proxyUrl = await resolveProxyUrlForAccount(conn, accountId);
        if (!proxyUrl) {
          logger.warn(`No proxy binding for account=${accountId}, skip task=${task.id}`);
          continue;
        }
      }

      const owner = lockOwner(task.id);
      if (subAccountId) {
        const lockOk = await acquireSubAccountRedisLock(subAccountId, owner);
        if (!lockOk) {
          logger.warn(`Sub-account lock not acquired, skip task=${task.id}, sub_account=${subAccountId}`);
          continue;
        }
        redisLocks.push({ key: subAccountLockKey(subAccountId), owner });

        const taskLocked = await transitionTaskToLocked(conn, task.id, { subAccountId });
        if (!taskLocked) {
          logger.warn(`Task ${task.id} was already taken`);
          continue;
        }
        await conn.query(
          `UPDATE sub_accounts SET is_busy = 1, locked_at = NOW(), locked_by = ? WHERE id = ?`,
          [`task-${task.id}`, subAccountId]
        );
        pubRedis.publish('account:update', JSON.stringify({ id: subAccountId, status: 'Busy', sub: true }));

        await taskQueue.add('send', {
          taskId: task.id,
          accountId: 0,
          sub_account_id: subAccountId,
          targetPhone: task.target_phone,
          content: task.content,
          mediaUrl: task.media_url || null,
          messageType: task.message_type || (task.media_url ? 'image' : 'text'),
          proxyUrl,
          tenantId: task.tenant_id,
        }, {
          jobId: `task-${task.id}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 200,
          removeOnFail: 200,
        });
        pubRedis.publish('task:update', JSON.stringify({ taskId: task.id, status: 'LOCKED', timestamp: Date.now() }));
        logger.info(`Dispatched task ${task.id} to sub_account ${subAccountId}`);
        continue;
      }

      const lockOk = await acquireAccountRedisLock(accountId, owner);
      if (!lockOk) {
        logger.warn(`Distributed account lock not acquired, skip task=${task.id}, account=${accountId}`);
        continue;
      }
      redisLocks.push({ key: accountLockKey(accountId), owner });

      const taskLocked = await transitionTaskToLocked(conn, task.id, { accountId });
      if (!taskLocked) {
        logger.warn(`Task ${task.id} was already taken by another worker/scheduler`);
        continue;
      }

      await conn.query(
          `UPDATE accounts 
           SET status = 'Busy', 
               locked_at = NOW(), 
               locked_by = ? 
           WHERE id = ?`,
          [`task-${task.id}`, accountId]
      );

      pubRedis.publish('account:update', JSON.stringify({
        id: accountId,
        status: 'Busy'
      }));

      await taskQueue.add('send', {
        taskId: task.id,
        accountId: accountId,
        targetPhone: task.target_phone,
        content: task.content,
        mediaUrl: task.media_url || null,
        messageType: task.message_type || (task.media_url ? 'image' : 'text'),
        proxyUrl: proxyUrl || null,
        tenantId: task.tenant_id
      }, {
        jobId: `task-${task.id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 200,
        removeOnFail: 200,
      });

      pubRedis.publish('task:update', JSON.stringify({
        taskId: task.id,
        status: 'LOCKED',
        timestamp: Date.now()
      }));

      logger.info(`Dispatched task ${task.id} to account ${accountId}`);
    }

    await conn.commit();

  } catch (error) {
    await conn.rollback();
    logger.error('Dispatch error', error);
  } finally {
    for (const lock of redisLocks) {
      try {
        await releaseRedisLock(lock.key, lock.owner);
      } catch (error: any) {
        logger.warn(`Failed to release lock ${lock.key}: ${error?.message || error}`);
      }
    }
    conn.release();
    dispatchInFlight = false;
  }
}

// If run directly via worker-entry.ts, it will be called there.
// No need for require.main === module check in ESM

