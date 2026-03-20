import { useEffect, useState, useRef, useCallback } from "react";
import api from "../api";
import type { DashboardStats, DashboardStatsResponse } from "../types/dashboard";

function mapResponse(res: DashboardStatsResponse): DashboardStats {
  const task = res.task ?? {};
  const account = res.account ?? {};
  const totalTasks = task.total ?? 0;
  const failedTasks = task.failed ?? 0;
  const runningTasks = task.inProgress ?? 0;
  const completionRate =
    totalTasks > 0
      ? Math.round(((totalTasks - failedTasks) / totalTasks) * 100)
      : (task.completed ?? 0);

  return {
    totalTasks,
    runningTasks,
    failedTasks,
    completionRate,
    totalAccounts: account.total ?? 0,
    onlineAccounts: account.online ?? 0,
    cooldownAccounts: account.cooldown ?? 0,
    deadAccounts: account.offline ?? 0,
    todaySent: account.todaySent ?? 0,
    todayFailed: account.todayFailed ?? 0,
    system: {
      lastUpdate: new Date().toISOString(),
      healthy: true,
    },
  };
}

/**
 * @param intervalMs 轮询间隔（毫秒），传 null 关闭轮询。
 * @returns { data, loading, error, refresh }
 */
export function useDashboardStats(intervalMs: number | null = 30_000) {
  const [data, setData] = useState<DashboardStats>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetch = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const resp: any = await api.get("/dashboard/stats", {
        signal: controller.signal,
      });
      setData(mapResponse(resp ?? {}));
    } catch (e: any) {
      if (e?.name === "AbortError" || e?.code === "ERR_CANCELED") return;
      console.error(e);
      setError(
        e?.response?.data?.message ?? e?.response?.data?.error ?? e?.message ?? "未知错误"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
    if (intervalMs !== null) {
      const timer = setInterval(fetch, intervalMs);
      return () => clearInterval(timer);
    }
  }, [fetch, intervalMs]);

  const refresh = useCallback(() => fetch(), [fetch]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return { data, loading, error, refresh };
}
