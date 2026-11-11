import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  importStarterSheet: vi.fn(),
  lookupStarter: vi.fn(),
  recordStarterTest: vi.fn(),
  downloadStarterTemplate: vi.fn(),
  showToast: vi.fn()
}));

vi.mock('../../api/batches', () => ({
  importStarterSheet: mocks.importStarterSheet,
  lookupStarter: mocks.lookupStarter,
  recordStarterTest: mocks.recordStarterTest,
  downloadStarterTemplate: mocks.downloadStarterTemplate
}));
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock('../../components/BarcodeScanDialog', () => ({ barcodeScanSupported: () => false, BarcodeScanDialog: () => null }));

import { FactoryStationView } from '../FactoryStationView';
import type { StarterStationView } from '../../types';

const starter = (over: Partial<StarterStationView> = {}): StarterStationView => ({
  found: true,
  id: 7,
  starter_id: 'AJ-0001',
  imei: '861234567890123',
  batch: { id: 'b1', batch_code: 'BATCH-1', revoked: false },
  details: { hp_rating: 7.5, supply_type: '3-phase', model: 'PCD-A7672S', hw_rev: '1.0', manufacture_date: '2026-11-30', notes: 'first lot' },
  test: { result: null, note: null, tested_at: null, tested_by: null },
  claim: { claimed: false, claimed_at: null, pump_id: null },
  pump: null,
  stages: [
    { key: 'on_sheet', label: 'On the uploaded sheet', done: true },
    { key: 'tested', label: 'Bench test passed', done: false },
    { key: 'claimed', label: 'Has its own AWS certificate (first power-up done)', done: false },
    { key: 'online', label: 'Reporting to the cloud', done: false },
    { key: 'farmer', label: 'Registered to a farmer', done: false }
  ],
  ...over
});

beforeEach(() => {
  Object.values(mocks).forEach(m => m.mockReset());
});

async function scan(code: string) {
  const input = screen.getByTestId('scan-input');
  await userEvent.type(input, `${code}{Enter}`);
}

describe('Factory Station: scanning', () => {
  it('shows the details from the sheet and how far the starter has got', async () => {
    mocks.lookupStarter.mockResolvedValue(starter());
    render(<FactoryStationView />);
    await scan('AJ-0001');
    expect(await screen.findByTestId('starter-id')).toHaveTextContent('AJ-0001');
    expect(mocks.lookupStarter).toHaveBeenCalledWith('AJ-0001');
    expect(screen.getByText('7.5 HP')).toBeInTheDocument();
    expect(screen.getByText('3-phase')).toBeInTheDocument();
    expect(screen.getByText('BATCH-1')).toBeInTheDocument();
    expect(screen.getByText(/first lot/)).toBeInTheDocument();
    expect(screen.getByTestId('stage-on_sheet')).toHaveTextContent('Done');
    expect(screen.getByTestId('stage-claimed')).toHaveTextContent('Waiting');
    expect(screen.getByText(/Waiting for the first power-up/)).toBeInTheDocument();
  });

  it('says plainly when the barcode is on no sheet', async () => {
    mocks.lookupStarter.mockRejectedValue(new Error("'NOPE' is not on any uploaded sheet. Check the barcode, or upload the batch's sheet first."));
    render(<FactoryStationView />);
    await scan('NOPE');
    expect(await screen.findByTestId('not-found')).toHaveTextContent('not on any uploaded sheet');
    expect(screen.queryByTestId('starter-card')).not.toBeInTheDocument();
  });

  it('clears the box and goes back to scanning with "Scan next"', async () => {
    mocks.lookupStarter.mockResolvedValue(starter());
    render(<FactoryStationView />);
    await scan('AJ-0001');
    await userEvent.click(await screen.findByTestId('scan-next'));
    expect(screen.queryByTestId('starter-card')).not.toBeInTheDocument();
    expect(screen.getByTestId('scan-input')).toHaveValue('');
  });

  it('shows a claimed, online starter as done and no longer waits for the first power-up', async () => {
    mocks.lookupStarter.mockResolvedValue(
      starter({
        claim: { claimed: true, claimed_at: '2026-11-11T10:00:00Z', pump_id: 'AJ-0001' },
        pump: { id: 'AJ-0001', status: 'STOPPED', lifecycle_state: 'COMMISSIONED', connectivity: 'ONLINE', last_seen_at: '2026-11-11T10:05:00Z', farmer: null },
        stages: [
          { key: 'on_sheet', label: 'On the uploaded sheet', done: true },
          { key: 'tested', label: 'Bench test passed', done: true },
          { key: 'claimed', label: 'Has its own AWS certificate (first power-up done)', done: true },
          { key: 'online', label: 'Reporting to the cloud', done: true },
          { key: 'farmer', label: 'Registered to a farmer', done: false }
        ]
      })
    );
    render(<FactoryStationView />);
    await scan('AJ-0001');
    expect(await screen.findByTestId('stage-claimed')).toHaveTextContent('Done');
    expect(screen.getByTestId('stage-online')).toHaveTextContent('Done');
    expect(screen.queryByText(/Waiting for the first power-up/)).not.toBeInTheDocument();
  });
});

describe('Factory Station: the bench test', () => {
  it('records a pass with the note', async () => {
    mocks.lookupStarter.mockResolvedValue(starter());
    mocks.recordStarterTest.mockResolvedValue(
      starter({ test: { result: 'PASS', note: 'all good', tested_at: '2026-11-11T10:00:00Z', tested_by: 'Ajanta Admin' } })
    );
    render(<FactoryStationView />);
    await scan('AJ-0001');
    await userEvent.type(await screen.findByLabelText(/Note \(optional\)/), 'all good');
    await userEvent.click(screen.getByTestId('test-pass'));
    await waitFor(() => expect(mocks.recordStarterTest).toHaveBeenCalledWith(7, 'PASS', 'all good'));
    expect(await screen.findByTestId('test-recorded')).toHaveTextContent('Passed');
    expect(screen.getByTestId('test-recorded')).toHaveTextContent('Ajanta Admin');
  });

  it('records a failure', async () => {
    mocks.lookupStarter.mockResolvedValue(starter());
    mocks.recordStarterTest.mockResolvedValue(starter({ test: { result: 'FAIL', note: null, tested_at: '2026-11-11T10:00:00Z', tested_by: 'A' } }));
    render(<FactoryStationView />);
    await scan('AJ-0001');
    await userEvent.click(await screen.findByTestId('test-fail'));
    await waitFor(() => expect(mocks.recordStarterTest).toHaveBeenCalledWith(7, 'FAIL', ''));
    expect(await screen.findByTestId('test-recorded')).toHaveTextContent('Failed');
  });

  it('does not allow testing a starter whose batch was revoked', async () => {
    mocks.lookupStarter.mockResolvedValue(starter({ batch: { id: 'b1', batch_code: 'BATCH-1', revoked: true } }));
    render(<FactoryStationView />);
    await scan('AJ-0001');
    expect(await screen.findByText(/has been revoked/)).toBeInTheDocument();
    expect(screen.getByTestId('test-pass')).toBeDisabled();
    expect(screen.getByTestId('test-fail')).toBeDisabled();
  });
});

describe('Factory Station: uploading the sheet', () => {
  const sheet = () => new File(['x'], 'starters.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  it('uploads the chosen file into the named batch and says what was saved', async () => {
    mocks.importStarterSheet.mockResolvedValue({ saved: true, created: 3, updated: 1, unchanged: 0, errors: [], batch: { batch_code: 'BATCH-X' } });
    render(<FactoryStationView />);
    await userEvent.clear(screen.getByTestId('batch-code'));
    await userEvent.type(screen.getByTestId('batch-code'), 'BATCH-X');
    await userEvent.upload(screen.getByTestId('sheet-file'), sheet());
    await userEvent.click(screen.getByTestId('upload-sheet'));
    await waitFor(() => expect(mocks.importStarterSheet).toHaveBeenCalledTimes(1));
    expect(mocks.importStarterSheet.mock.calls[0][1]).toBe('BATCH-X');
    expect(await screen.findByTestId('upload-ok')).toHaveTextContent('3 new, 1 updated, 0 unchanged');
  });

  it('lists every problem by row when the sheet is rejected, and says nothing was saved', async () => {
    mocks.importStarterSheet.mockResolvedValue({
      saved: false,
      errors: [
        { row: 4, starter_id: 'AJ-1', reason: 'the same Starter ID is already in row 2' },
        { row: 7, starter_id: '', reason: 'no Starter ID' }
      ]
    });
    render(<FactoryStationView />);
    await userEvent.upload(screen.getByTestId('sheet-file'), sheet());
    await userEvent.click(screen.getByTestId('upload-sheet'));
    const problems = await screen.findByTestId('upload-problems');
    expect(problems).toHaveTextContent('Nothing was saved');
    expect(problems).toHaveTextContent('the same Starter ID is already in row 2');
    expect(problems).toHaveTextContent('no Starter ID');
  });

  it('shows the server\'s message when the file cannot be read at all', async () => {
    mocks.importStarterSheet.mockRejectedValue(new Error('That is not a readable Excel (.xlsx) file.'));
    render(<FactoryStationView />);
    await userEvent.upload(screen.getByTestId('sheet-file'), sheet());
    await userEvent.click(screen.getByTestId('upload-sheet'));
    expect(await screen.findByText(/not a readable Excel/)).toBeInTheDocument();
  });

  it('cannot upload before a file is chosen', () => {
    render(<FactoryStationView />);
    expect(screen.getByTestId('upload-sheet')).toBeDisabled();
  });
});
