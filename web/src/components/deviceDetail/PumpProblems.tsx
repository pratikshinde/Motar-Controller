import React from 'react';
import { Alert, AlertTitle, Box } from '@mui/material';
import { pumpProblems } from '../../utils/pumpMonitor';
import type { PumpDetail } from '../../types';

/**
 * Right at the top of the pump's page: whatever is wrong with this pump, so an admin does not have to open a tab to find out.
 * Nothing is drawn when nothing is wrong.
 */
export const PumpProblems: React.FC<{ detail: PumpDetail }> = ({ detail }) => {
  const problems = pumpProblems(detail.pump, detail.open_fault_count ?? 0);
  if (problems.length === 0) return null;
  return (
    <Box data-testid="pump-problems" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {problems.map((p) => (
        <Alert key={p.key} severity={p.severity} variant="outlined" data-testid={`problem-${p.key}`}>
          <AlertTitle sx={{ mb: 0, fontWeight: 700 }}>{p.title}</AlertTitle>
          {p.detail}
        </Alert>
      ))}
    </Box>
  );
};
