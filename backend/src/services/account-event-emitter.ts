import { EventEmitter } from 'events';

export class AccountEventEmitter extends EventEmitter {
  emitUpdate(payload: {
    id: string;
    status?: string;
    error_msg?: string | null;
    [key: string]: any;
  }) {
    this.emit('account:update', payload);
  }
}

// 单例导出
export const accountEventEmitter = new AccountEventEmitter();
