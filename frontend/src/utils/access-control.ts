export type CanonicalRole = 'super_admin' | 'agent' | 'user';

export const normalizeAppRole = (raw: unknown): CanonicalRole | null => {
  const role = String(raw || '').trim().toLowerCase();

  if (!role) return null;

  if (['super_admin', 'admin', 'root', 'seed_admin'].includes(role)) {
    return 'super_admin';
  }

  if (['agent', 'tenant_admin', 'tenant-manager', 'manager'].includes(role)) {
    return 'agent';
  }

  if (['user', 'operator', 'member', 'sales', 'staff'].includes(role)) {
    return 'user';
  }

  return null;
};

export const canAccessAccountManager = (role: CanonicalRole | null) =>
  role === 'super_admin' || role === 'agent';

export const canManageSubaccounts = (role: CanonicalRole | null) =>
  role === 'super_admin' || role === 'agent';

export const canUseConversations = (role: CanonicalRole | null) =>
  role === 'super_admin' || role === 'user';

export const canUseTasks = (role: CanonicalRole | null) =>
  role === 'super_admin' || role === 'user';

export const getDefaultAdminRoute = (role: CanonicalRole | null) => {
  if (role === 'user') {
    return '/admin/conversations';
  }

  if (role === 'super_admin' || role === 'agent') {
    return '/admin/accounts';
  }

  return '/admin/dashboard';
};
