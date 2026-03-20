import { getAuthToken } from '../utils/jwt-auth';

/**
 * Tauri 后端启动和认证管理器
 */
export class TauriAuthManager {
  private static backendPort: number = 3000;
  private static backendHealthy = false;
  private static remoteBackendUrl = (import.meta.env.VITE_API_URL?.trim() || 'https://hkd.llc').replace(/\/+$/, '');
  private static useLocalBackend =
    import.meta.env.DEV &&
    String(import.meta.env.VITE_USE_LOCAL_BACKEND || '').trim().toLowerCase() === 'true';

  /**
   * 初始化 Tauri 应用 (在应用启动时调用)
   * 默认统一连接正式域名后端。
   * 只有显式设置 VITE_USE_LOCAL_BACKEND=true 时才会连接本地后端。
   */
  static async init(): Promise<void> {
    console.log('[Tauri] 初始化认证管理器...');

    // 检查是否已有有效的 token
    const existingToken = getAuthToken();
    if (existingToken) {
      console.log('[Tauri] ✅ 找到现有 token，跳过登录');
      return;
    }

    if (this.useLocalBackend) {
      console.warn(`[Tauri] 当前显式启用了本地后端：http://localhost:${this.backendPort}`);
    } else {
      console.log(`[Tauri] 使用远端 API：${this.remoteBackendUrl}`);
    }

    await this.checkBackendHealth();
  }

  /** 健康检查超时（毫秒），避免一直打转 */
  private static readonly HEALTH_TIMEOUT_MS = 8000;

  /**
   * 检查后端是否健康（带超时，超时后不阻塞启动）
   */
  static async checkBackendHealth(): Promise<boolean> {
    const url = `${this.getApiBaseUrl().replace(/\/api$/, '')}/health`;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.HEALTH_TIMEOUT_MS);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      this.backendHealthy = response.ok;
      console.log(`[Tauri] 后端状态: ${this.backendHealthy ? '✅ 正常' : '❌ 异常'}`);
      return this.backendHealthy;
    } catch (err) {
      console.warn('[Tauri] 后端健康检查失败或超时，继续启动:', err);
      this.backendHealthy = false;
      return false;
    }
  }

  /**
   * 清理资源 (应用关闭时调用)
   */
  static async cleanup(): Promise<void> {
    return;
  }

  /**
   * 获取后端 URL
   */
  static getBackendUrl(): string {
    if (this.useLocalBackend) {
      return `http://localhost:${this.backendPort}`;
    }
    return this.remoteBackendUrl;
  }

  /**
   * 获取后端 API 基础 URL
   */
  static getApiBaseUrl(): string {
    return `${this.getBackendUrl()}/api`;
  }
}

export default TauriAuthManager;
