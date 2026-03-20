const TENANT_SCOPE_KEY = "tenant_scope_id";
const TENANT_SCOPE_NUMBER_KEY = "tenant_scope_number";

export const readTenantScope = (): number | undefined => {
  const raw = localStorage.getItem(TENANT_SCOPE_KEY);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

/** 供 Chat 等需要 tenantId + tenantNumber 的页面使用 */
export const readTenantScopeObject = (): { tenantId: string; tenantNumber: string } => {
  const id = readTenantScope();
  const number = localStorage.getItem(TENANT_SCOPE_NUMBER_KEY) ?? "";
  return {
    tenantId: id != null ? String(id) : "",
    tenantNumber: number,
  };
};

export const writeTenantScope = (value: string | { tenantId: string; tenantNumber?: string }) => {
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) {
      localStorage.removeItem(TENANT_SCOPE_KEY);
      return;
    }
    const numeric = Number(normalized);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      localStorage.removeItem(TENANT_SCOPE_KEY);
      return;
    }
    localStorage.setItem(TENANT_SCOPE_KEY, String(Math.trunc(numeric)));
    return;
  }
  const { tenantId: tid, tenantNumber: num } = value;
  const normalizedId = String(tid ?? "").trim();
  if (normalizedId) {
    const n = Number(normalizedId);
    if (Number.isFinite(n) && n > 0) {
      localStorage.setItem(TENANT_SCOPE_KEY, String(Math.trunc(n)));
    }
  } else {
    localStorage.removeItem(TENANT_SCOPE_KEY);
  }
  if (num !== undefined) {
    if (String(num).trim()) localStorage.setItem(TENANT_SCOPE_NUMBER_KEY, String(num).trim());
    else localStorage.removeItem(TENANT_SCOPE_NUMBER_KEY);
  }
};

type TenantParamInput =
  | number
  | { tenantId?: number; tenantNumber?: string; conversationId?: string };

export const toTenantParams = (arg?: TenantParamInput) => {
  if (arg == null) return {};
  if (typeof arg === "number") {
    return Number.isFinite(arg) ? { tenantId: arg } : {};
  }
  const o: Record<string, string | number> = {};
  if (arg.tenantId != null && Number.isFinite(Number(arg.tenantId))) o.tenantId = Number(arg.tenantId);
  if (arg.tenantNumber != null && String(arg.tenantNumber).trim()) o.tenantNumber = String(arg.tenantNumber).trim();
  if (arg.conversationId != null && String(arg.conversationId).trim()) o.conversationId = String(arg.conversationId).trim();
  return o;
};
