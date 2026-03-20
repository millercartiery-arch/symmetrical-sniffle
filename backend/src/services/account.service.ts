import { pool } from '../shared/db.js';
import { accountEventEmitter } from './account-event-emitter.js';
import { EventPublisher } from './event-publisher.js';

/**
 * AccountService - 账户业务逻辑层
 * 负责账户状态管理、登录检测、事件发射等
 */
export class AccountService {
  /**
   * 获取账户信息
   */
  static async getAccount(id: string) {
    const conn = await pool.getConnection();
    try {
      const [rows]: any = await conn.execute(
        'SELECT * FROM accounts WHERE id = ?',
        [id]
      );
      return rows[0] || null;
    } catch (err) {
      console.error('Failed to fetch account:', err);
      return null;
    } finally {
      conn.release();
    }
  }

  /**
   * 获取所有账户（支持筛选）
   */
  static async getAllAccounts(status?: string) {
    const conn = await pool.getConnection();
    try {
      let sql = 'SELECT id, phone, email, username, status, error_msg, updated_at FROM accounts';
      const params: any[] = [];

      if (status) {
        sql += ' WHERE status = ?';
        params.push(status);
      }

      sql += ' ORDER BY updated_at DESC';

      const [rows]: any = await conn.execute(sql, params);
      return rows;
    } catch (err) {
      console.error('Failed to fetch all accounts:', err);
      return [];
    } finally {
      conn.release();
    }
  }

  /**
   * 更新账户状态
   * @param id 账户ID
   * @param status 新状态
   * @param errorMsg 错误消息（可选）
   */
  static async updateStatus(id: string, status: string, errorMsg?: string) {
    const conn = await pool.getConnection();
    try {
      await conn.execute(
        'UPDATE accounts SET status = ?, error_msg = ?, updated_at = NOW() WHERE id = ?',
        [status, errorMsg || null, id]
      );

      const payload = {
        id,
        status,
        error_msg: errorMsg || null,
      };

      // 💡 本地事件发射（用于本进程监听）
      accountEventEmitter.emitUpdate(payload);

      // 💡 Redis 发布（用于全局 Socket.io 广播）
      await EventPublisher.publishAccountUpdate(payload);

      console.log(`✅ Account ${id} status updated to ${status}`);
    } catch (err) {
      console.error('Failed to update account status:', err);
      throw err;
    } finally {
      conn.release();
    }
  }

  /**
   * 登录检测 - 验证账户是否可用
   * 在实际环境中，这会调用 TextNow API 或 Puppeteer
   */
  static async probeAccount(id: string) {
    try {
      // 步骤 1：设置为"登录中"
      await this.updateStatus(id, 'LOGGING_IN', null);

      // 步骤 2：TODO - 调用实际的验证逻辑
      // 例如：通过 API 获取 token，或使用 Puppeteer 模拟登录
      // const sender = getSender();
      // await sender.sendMessage(id, 'PROBE_NUMBER', 'Probe');

      // 模拟验证延迟
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // 步骤 3：成功设置为"就绪"
      await this.updateStatus(id, 'READY', null);

      return { success: true, accountId: id };
    } catch (err: any) {
      // 失败设置为"错误"
      await this.updateStatus(id, 'ERROR', err.message);
      throw err;
    }
  }

  /**
   * 设置账户为忙碌状态（发送任务前）
   */
  static async setBusy(id: string) {
    await this.updateStatus(id, 'BUSY', null);
  }

  /**
   * 设置账户为空闲状态（发送完成后）
   * 如果之前是错误状态，保持错误状态；否则设为"就绪"
   */
  static async setIdle(id: string) {
    const account = await this.getAccount(id);
    if (!account) {
      console.warn(`Account ${id} not found`);
      return;
    }

    const newStatus = account.status === 'ERROR' ? 'ERROR' : 'READY';
    await this.updateStatus(id, newStatus, null);
  }

  /**
   * 禁用/启用账户
   */
  static async setDisabled(id: string, disabled: boolean) {
    const status = disabled ? 'DISABLED' : 'READY';
    await this.updateStatus(id, status, null);
  }

  /**
   * 获取可用的账户（用于任务分配）
   */
  static async getAvailableAccount() {
    const conn = await pool.getConnection();
    try {
      const [rows]: any = await conn.execute(
        "SELECT id, phone, email, username, status FROM accounts WHERE status = 'READY' ORDER BY updated_at ASC LIMIT 1"
      );
      return rows[0] || null;
    } catch (err) {
      console.error('Failed to get available account:', err);
      return null;
    } finally {
      conn.release();
    }
  }
}
