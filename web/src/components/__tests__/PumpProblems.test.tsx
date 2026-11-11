import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PumpProblems } from '../deviceDetail/PumpProblems';
import type { PumpDetail } from '../../types';

const detail = (pump: Record<string, unknown>, open = 0) => ({ pump: { id: 'P1', name: 'Pump', ...pump }, open_fault_count: open }) as unknown as PumpDetail;

describe('PumpProblems', () => {
  it('draws nothing for a healthy pump', () => {
    render(<PumpProblems detail={detail({ status: 'RUNNING', connectivity: 'ONLINE', power_state: 'ON' })} />);
    expect(screen.queryByTestId('pump-problems')).toBeNull();
  });

  it('shows each problem right at the top of the pump', () => {
    render(<PumpProblems detail={detail({ status: 'FAULT', fault_active: true, fault_code: 6, connectivity: 'ONLINE', power_state: 'OFF', power_source: 'VOLTAGE' }, 2)} />);
    expect(screen.getByTestId('pump-problems')).toBeInTheDocument();
    expect(screen.getByText('Fault: Cable open')).toBeInTheDocument();
    expect(screen.getByText('2 unresolved fault events')).toBeInTheDocument();
    expect(screen.getByText(/^Power is off/)).toBeInTheDocument();
  });

  it('says a pump that went quiet is not reporting', () => {
    render(<PumpProblems detail={detail({ status: 'STOPPED', connectivity: 'OFFLINE', last_seen_at: new Date(Date.now() - 3600_000).toISOString() })} />);
    expect(screen.getByTestId('problem-offline')).toBeInTheDocument();
  });
});
