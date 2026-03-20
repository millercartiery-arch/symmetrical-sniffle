
# Commercialization Implementation Progress

Based on `COMMERCIALIZATION_SPEC.md`, we have started the implementation.

## Phase 1: Task Scheduler MVP (Completed)

We have implemented the core Task Scheduler and Worker using **BullMQ (Redis)** and **MySQL**.

### Components Implemented:
1.  **Database Schema**: Updated `message_tasks` table with `tenant_id`, `status`, `locked_at`, `sent_at`, `error_msg`, `scheduled_at`.
2.  **Scheduler (`src/workers/scheduler.ts`)**:
    - Runs every 2 seconds.
    - Polls `message_tasks` for `PENDING` tasks scheduled for now or earlier.
    - Assigns an available `Ready` account from `accounts` table.
    - Locks the task and account to prevent double assignment.
    - Pushes task to Redis queue `tn-send`.
3.  **Worker (`src/workers/worker.ts`)**:
    - Consumes tasks from Redis queue `tn-send`.
    - Uses **Puppeteer Cluster** (configured for 5 concurrent browsers).
    - Currently runs a **Simulated Send** (waits 1s and marks success) to verify the pipeline.
    - Updates `message_tasks` status to `SUCCESS` or `FAILED`.
    - Releases the account back to `Ready` status.
4.  **Entry Point**: `src/worker-entry.ts` to run both services.

### How to Run:
1.  **Prerequisites**:
    - **Redis** must be running on `localhost:6379` (or configure `REDIS_HOST` in `.env`).
    - **Node.js** dependencies installed (`npm install`).
2.  **Start Worker**:
    ```bash
    npm run start:worker
    ```
3.  **Start Backend (API)**:
    ```bash
    npm start
    ```

### Next Steps (Phase 2 & 3):
1.  **Real Sender Implementation**: Replace the simulated logic in `worker.ts` with actual TextNow automation (Login, Captcha, Send).
    - Requires **2Captcha API Key**.
    - Requires **Proxies**.
2.  **Security**: Implement `tenant_id` isolation in API and `libsodium` encryption for account passwords.

### Configuration
Check `.env` for:
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
- `DB_HOST`, `DB_USER`, `DB_PASSWORD`
- **`PROXY_ENC_KEY`**（可选）：IP 代理密码 AES 加密密钥，32 字节 base64；未配置时回退到 `MSG_ENC_KEY`。生成示例：`openssl rand -base64 32`。迁移已有明文密码：`npm run migrate:proxy-pass`（需先执行 proxy schema 的 `auth_pass_enc` 列）。
