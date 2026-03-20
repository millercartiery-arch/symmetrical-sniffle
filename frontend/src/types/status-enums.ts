
export enum AccountStatus {
  VALID = 'VALID',
  INVALID_INCOMPLETE = 'INVALID_INCOMPLETE',
  DEAD = 'DEAD',
  ASSIGNED = 'ASSIGNED',
  UNASSIGNED = 'UNASSIGNED',
  READY = 'Ready', // Legacy
  BANNED = 'Banned', // Legacy
  BUSY = 'Busy', // Legacy
}

export enum NumberStatus {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
  COOLDOWN = 'COOLDOWN',
  EXPIRED = 'EXPIRED',
  RECYCLED = 'RECYCLED',
  STOPPED_LIMIT = 'STOPPED_LIMIT',
}

export enum TaskStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  PAUSED = 'PAUSED',
  FAILED = 'FAILED',
  COMPLETED = 'COMPLETED',
  STOPPED_LIMIT = 'STOPPED_LIMIT',
  PENDING = 'Pending', // Legacy
  ASSIGNED = 'Assigned', // Legacy
  IN_PROGRESS = 'In Progress', // Legacy
  CANCELLED = 'Cancelled', // Legacy
}

export type StatusType = 'account' | 'number' | 'task';
