import crypto from "crypto";

export interface SubAccount {
  subAccountId: string;
  apiKey: string;
  assignmentQuota: number;
  assignedSessionIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface DistributionStrategy {
  distribute(input: {
    globalSessionIds: string[];
    subAccounts: Array<Pick<SubAccount, "subAccountId" | "assignmentQuota">>;
  }): Record<string, string[]>;
}

export class SequentialSliceDistributionStrategy implements DistributionStrategy {
  distribute(input: {
    globalSessionIds: string[];
    subAccounts: Array<Pick<SubAccount, "subAccountId" | "assignmentQuota">>;
  }): Record<string, string[]> {
    const output: Record<string, string[]> = {};
    let cursor = 0;
    const pool = input.globalSessionIds;
    for (const sub of input.subAccounts) {
      const quota = Math.max(0, sub.assignmentQuota || 0);
      output[sub.subAccountId] = pool.slice(cursor, cursor + quota);
      cursor += quota;
    }
    return output;
  }
}

export class TenantResourceManager {
  private globalSessionIds: string[] = [];
  private subAccounts = new Map<string, SubAccount>();
  private strategy: DistributionStrategy = new SequentialSliceDistributionStrategy();

  setDistributionStrategy(strategy: DistributionStrategy) {
    this.strategy = strategy;
  }

  setGlobalSessionPool(ids: string[]) {
    this.globalSessionIds = Array.from(new Set(ids.filter(Boolean)));
    this.redistribute();
  }

  getGlobalSessionPool() {
    return [...this.globalSessionIds];
  }

  createSubAccounts(count: number, perAccount: number) {
    const n = Math.max(1, Math.min(1000, Number(count || 1)));
    const quota = Math.max(0, Math.min(100000, Number(perAccount || 0)));
    const created: SubAccount[] = [];
    const existingIds = new Set(this.subAccounts.keys());
    let seq = 1;
    while (created.length < n) {
      const id = `sub-${seq}`;
      seq += 1;
      if (existingIds.has(id)) continue;
      const now = Date.now();
      const sub: SubAccount = {
        subAccountId: id,
        apiKey: `sak_${crypto.randomUUID().replace(/-/g, "")}`,
        assignmentQuota: quota,
        assignedSessionIds: [],
        createdAt: now,
        updatedAt: now,
      };
      this.subAccounts.set(id, sub);
      created.push(sub);
    }
    this.redistribute();
    return created;
  }

  upsertSubAccount(input: { subAccountId: string; assignmentQuota: number; apiKey?: string }) {
    const id = String(input.subAccountId || "").trim();
    if (!id) throw new Error("subAccountId is required");
    const quota = Math.max(0, Number(input.assignmentQuota || 0));
    const now = Date.now();
    const existing = this.subAccounts.get(id);
    if (!existing) {
      this.subAccounts.set(id, {
        subAccountId: id,
        assignmentQuota: quota,
        apiKey: input.apiKey || `sak_${crypto.randomUUID().replace(/-/g, "")}`,
        assignedSessionIds: [],
        createdAt: now,
        updatedAt: now,
      });
    } else {
      existing.assignmentQuota = quota;
      if (input.apiKey) existing.apiKey = input.apiKey;
      existing.updatedAt = now;
      this.subAccounts.set(id, existing);
    }
    this.redistribute();
  }

  redistribute() {
    const accounts = this.listSubAccounts().map((s) => ({
      subAccountId: s.subAccountId,
      assignmentQuota: s.assignmentQuota,
    }));
    const mapping = this.strategy.distribute({
      globalSessionIds: this.globalSessionIds,
      subAccounts: accounts,
    });
    const now = Date.now();
    for (const sub of this.subAccounts.values()) {
      sub.assignedSessionIds = mapping[sub.subAccountId] || [];
      sub.updatedAt = now;
    }
  }

  listSubAccounts() {
    return Array.from(this.subAccounts.values()).sort((a, b) => a.subAccountId.localeCompare(b.subAccountId));
  }

  getSubAccount(subAccountId: string) {
    return this.subAccounts.get(subAccountId) || null;
  }

  getAssignedSessionIds(subAccountId: string) {
    return [...(this.subAccounts.get(subAccountId)?.assignedSessionIds || [])];
  }

  validateApiKey(subAccountId: string, apiKey?: string) {
    const sub = this.subAccounts.get(subAccountId);
    if (!sub) return false;
    return !!apiKey && sub.apiKey === apiKey;
  }
}

