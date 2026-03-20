# Stateless Protocol Gateway

## Module layout

- `src/gateway/contracts.ts`: Gateway request/response contracts
- `src/gateway/error-codes.ts`: Unified gateway error code system
- `src/gateway/errors.ts`: Typed error model
- `src/gateway/normalizer.ts`: Request validation and normalization
- `src/gateway/adapters.ts`: iOS/Android adapter logic
- `src/gateway/transport-driver.ts`: Stateless transport driver (timeout/retry)
- `src/gateway/service.ts`: End-to-end orchestration

## API routes

- `POST /api/gateway/validate`: validate input and produce request/idempotency keys
- `POST /api/gateway/build-packet`: dry-run packet build (no upstream send)
- `POST /api/gateway/send`: execute stateless send flow
- `POST /api/gateway/send-batch`: async orchestrated batch dispatch with concurrency shaping
- `POST /api/gateway/media/build-multipart`: build RFC 7578 multipart body from local absolute path
- `POST /api/gateway/dispatch/build`: build full dispatch request (headers/body/http2 pseudo headers)
- `POST /api/sessions/import`: import SessionContext list from raw text/file
- `GET /api/system/stats`: realtime queue/flow/session stats for management UI
- `POST /api/sessions/:id/circuit/open`: manual circuit-open for one session
- `POST /api/sessions/:id/circuit/close`: manual recover for one session
- `POST /api/system/dispatch/submit-batch`: enqueue batch tasks into DispatchEngine queue
- `GET /api/admin/dashboard`: management UI entry
- `POST /api/system/control/pause-all`: atomically pause all queue consumers and session scheduling
- `POST /api/system/control/resume-all`: atomically resume scheduling
- `POST /api/system/control/drain-queue`: drop queued (not in-flight) tasks
- `POST /api/subaccounts/create`: create sub-accounts and slice global TN pool
- `GET /api/subaccounts`: get sub-account quota/online/running monitor
- `POST /api/subaccounts/:id/quota`: hot-update one sub-account quota (hot reload)
- `POST /api/subaccounts/distribute`: re-run distribution strategy
- `GET /api/system/logs?subAccountId=sub-1`: filter dispatch logs by sub-account

## Request example

```json
{
  "tenantId": "tenant-a",
  "platform": "iOS",
  "session": {
    "Cookie": "_pxhd=...",
    "X-PX-AUTHORIZATION": "3:....",
    "clientId": "abc123",
    "User-Agent": "TextNow/26.8.0 (iPhone14,8; iOS 18.4.1; Scale/3.00)"
  },
  "message": {
    "to": "+15550100001",
    "type": "image",
    "text": "hello",
    "mediaUrl": "https://example.com/img.png"
  },
  "hints": {
    "endpoint": "https://upstream.example.com/v1/send",
    "method": "POST",
    "protocolVersion": "v1",
    "adapterVersion": "v1",
    "timeoutMs": 10000,
    "maxRetries": 1
  }
}
```

## Unified send interface

### `POST /api/gateway/send`

- Supports dispatch-aware send:
  - `request`: GatewaySendRequest
  - `profile`: DeviceProfile
  - `localAbsolutePath` (optional for image multipart build)

### `POST /api/gateway/send-batch`

```json
{
  "jobs": [
    {
      "jobId": "job-1",
      "sessionContextId": "ctx-1",
      "input": {
        "request": { "...": "GatewaySendRequest" },
        "profile": { "...": "DeviceProfile" },
        "localAbsolutePath": "C:\\\\assets\\\\a.png"
      }
    }
  ],
  "options": {
    "maxConcurrency": 10,
    "platformConcurrency": { "iOS": 6, "Android": 4 },
    "profileMinIntervalMs": 5,
    "failFast": false
  }
}
```

## Error code families

- `GW_4xx_*`: input/session/protocol validation errors
- `GW_50x_TRANSPORT_*`: timeout/network failures
- `GW_502_UPSTREAM_*`: upstream returned non-success response
- `GW_200_OK`: successful send

## Notes

- Service is stateless: no local session cache is required.
- Idempotency key defaults to SHA-256 hash over tenant/platform/target/content tuple.
- Adapter branches only for platform-specific header strategy and payload profile.
- Binary-to-Hex conversion is supported via preview fields (`bodyHexPreview`, `fileHexPreview`) for diagnostics.
- Media payload builder now supports stream body construction to avoid large-buffer memory spikes.
- Hex output is preview-only by default (`bodyHexPreview`/`fileHexPreview`).
- Session-PX is only injected from upstream-provided legal token; hardware fingerprint/JA3 spoofing is intentionally not implemented in gateway.
- Orchestrator supports asynchronous batch dispatch with per-platform and per-profile traffic shaping.
- `/api/system/stats` uses short-lived in-memory snapshot caching (1s) to reduce polling pressure.

## Scheduling components

- `MessageQueueManager`: in-memory async queue with worker concurrency and retry
- `SessionRotator`: round-robin profile selection with cooldown + pause/resume
- `FlowController`: token-bucket rate control + circuit breaker (default threshold: 5)
- `DispatchEngine`: integrates queue + rotator + flow-controller + gateway service

### Core interaction pseudocode

```text
enqueue(tasks)
start workers (N)
for each task in worker:
  session = rotator.acquireNext(preferredPlatform)
  if no session -> requeue(delay)
  if flowController.circuitOpen(session) -> requeue(delay)
  flowController.acquireDispatchPermit(session.platform)   // token bucket
  result = sendDispatched(task, session)
  flowController.recordResult(session.id, result)
  if circuit opened after failures -> rotator.pause(session.id), alert()
  rotator.release(session.id, cooldownMs)
  if retryable fail -> requeue(backoff)
```

## Sub-account quota model

- `SubAccount`:
  - `subAccountId`
  - `apiKey`
  - `assignmentQuota`
  - `assignedSessionIds[]`
- `DistributionStrategy`:
  - Default strategy is `SequentialSliceDistributionStrategy`
  - `create_sub_accounts(count=5, per_account=10)` slices TN pool as:
    - first 10 -> sub-1
    - next 10 -> sub-2
    - ...
- Isolation:
  - Dispatch task can carry `subAccountId` + `subAccountApiKey`
  - Scheduler only acquires sessions from that sub-account's assigned group
  - Priority scheduling is supported via task `priority`

### `create_sub_accounts(count=5, per_account=10)` behavior

- Uses global TN pool imported from `50.txt`
- Default strategy: sequential slicing
  - `sub-1` gets first 10 TN instances
  - `sub-2` gets next 10
  - ...
- Each sub-account gets an auto-generated API key (`sak_*`) for isolated dispatch calls
