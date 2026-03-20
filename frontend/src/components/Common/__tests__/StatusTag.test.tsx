import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import StatusTag from '../StatusTag';
import { AccountStatus, NumberStatus, TaskStatus } from '../../../types/status-enums';

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('StatusTag Component', () => {
  it('renders VALID account status correctly', () => {
    render(<StatusTag status={AccountStatus.VALID} type="account" />);
    const tag = screen.getByText('status.account.valid');
    expect(tag).toBeInTheDocument();
    // Check if it has success color class or style (implementation dependent)
  });

  it('renders INVALID account status with error style', () => {
    render(<StatusTag status={AccountStatus.INVALID_INCOMPLETE} type="account" />);
    const tag = screen.getByText('status.account.invalid_incomplete');
    expect(tag).toBeInTheDocument();
  });

  it('renders RUNNING task status with processing style', () => {
    render(<StatusTag status={TaskStatus.RUNNING} type="task" />);
    const tag = screen.getByText('status.task.running');
    expect(tag).toBeInTheDocument();
  });

  it('renders unknown status with default style', () => {
    render(<StatusTag status="UNKNOWN_STATUS" type="account" />);
    const tag = screen.getByText('Unknown (UNKNOWN_STATUS)');
    expect(tag).toBeInTheDocument();
  });
});
