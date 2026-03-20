import React from 'react';
import { Tag } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  StopOutlined,
  SyncOutlined,
  MinusCircleOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { AccountStatus, NumberStatus, TaskStatus, StatusType } from '../../types/status-enums';

interface StatusTagProps {
  status: string;
  type: StatusType;
}

const StatusTag: React.FC<StatusTagProps> = ({ status, type }) => {
  const { t } = useTranslation();

  // Mapping configurations
  const config: Record<string, { color: string; icon: React.ReactNode; labelKey: string }> = {
    // Account Status (Enhanced)
    'UNKNOWN': { color: 'default', icon: <MinusCircleOutlined />, labelKey: 'status.account.unknown' },
    'LOGGING_IN': { color: 'processing', icon: <SyncOutlined spin />, labelKey: 'status.account.logging_in' },
    'READY': { color: 'success', icon: <CheckCircleOutlined />, labelKey: 'status.account.ready' },
    'BUSY': { color: 'warning', icon: <SyncOutlined spin />, labelKey: 'status.account.busy' },
    'ERROR': { color: 'error', icon: <CloseCircleOutlined />, labelKey: 'status.account.error' },
    'DISABLED': { color: 'default', icon: <StopOutlined />, labelKey: 'status.account.disabled' },

    // Account Status (Legacy)

    // Number Status
    [NumberStatus.ONLINE]: { color: 'success', icon: <CheckCircleOutlined />, labelKey: 'status.number.online' },
    [NumberStatus.OFFLINE]: { color: 'default', icon: <MinusCircleOutlined />, labelKey: 'status.number.offline' },
    [NumberStatus.COOLDOWN]: { color: 'warning', icon: <ClockCircleOutlined />, labelKey: 'status.number.cooldown' },
    [NumberStatus.EXPIRED]: { color: 'error', icon: <StopOutlined />, labelKey: 'status.number.expired' },
    [NumberStatus.RECYCLED]: { color: 'default', icon: <SyncOutlined />, labelKey: 'status.number.recycled' },
    // STOPPED_LIMIT handled dynamically below due to key collision with TaskStatus


    // Task Status
    [TaskStatus.QUEUED]: { color: 'default', icon: <ClockCircleOutlined />, labelKey: 'status.task.queued' },
    [TaskStatus.RUNNING]: { color: 'processing', icon: <SyncOutlined spin />, labelKey: 'status.task.running' },
    [TaskStatus.PAUSED]: { color: 'warning', icon: <ClockCircleOutlined />, labelKey: 'status.task.paused' },
    [TaskStatus.FAILED]: { color: 'error', icon: <CloseCircleOutlined />, labelKey: 'status.task.failed' },
    [TaskStatus.COMPLETED]: { color: 'success', icon: <CheckCircleOutlined />, labelKey: 'status.task.completed' },
    [TaskStatus.STOPPED_LIMIT]: { color: 'warning', icon: <ExclamationCircleOutlined />, labelKey: 'status.task.stopped_limit' },
    [TaskStatus.PENDING]: { color: 'default', icon: <ClockCircleOutlined />, labelKey: 'status.task.pending' }, // Legacy
    [TaskStatus.ASSIGNED]: { color: 'processing', icon: <CheckCircleOutlined />, labelKey: 'status.task.assigned' }, // Legacy
    [TaskStatus.IN_PROGRESS]: { color: 'processing', icon: <SyncOutlined spin />, labelKey: 'status.task.in_progress' }, // Legacy
    [TaskStatus.CANCELLED]: { color: 'default', icon: <StopOutlined />, labelKey: 'status.task.cancelled' }, // Legacy
  };

  const statusConfig = config[status];

  // Handle STOPPED_LIMIT collision
  if (status === 'STOPPED_LIMIT' && type === 'number') {
    return (
      <Tag color="warning" icon={<ExclamationCircleOutlined />}>
        {t('status.number.stopped_limit', { defaultValue: '已达上限' })}
      </Tag>
    );
  }

  if (!statusConfig) {
    return <Tag>{`Unknown (${status})`}</Tag>;
  }

  return (
    <Tag color={statusConfig.color} icon={statusConfig.icon}>
      {t(statusConfig.labelKey, { defaultValue: status })}
    </Tag>
  );
};

export default StatusTag;
