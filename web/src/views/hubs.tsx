import React from 'react';
import { Box, Tab, Tabs } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useViewing } from '../api/viewing';
import { TelemetryView } from './TelemetryView';
import { AlertsView } from './AlertsView';
import { FaultLogsView } from './FaultLogsView';
import { DevicesView } from './DevicesView';
import { FactoryStationView } from './FactoryStationView';

export interface HubTab {
  key: string;
  label: string;
  element: React.ReactNode;
  /** Give the tab a fixed, screen-high area (the map needs one to draw in). */
  fill?: boolean;
  hidden?: boolean;
}

/** One page with a few tabs, the chosen one kept in the address (?tab=map) so a link, a reload and the back button all land on the same tab. */
export const TabbedPage: React.FC<{ tabs: HubTab[] }> = ({ tabs }) => {
  const [params, setParams] = useSearchParams();
  const shown = tabs.filter(t => !t.hidden);
  const active = shown.find(t => t.key === params.get('tab')) ?? shown[0];
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {shown.length > 1 && (
        <Tabs
          value={active.key}
          onChange={(_, key: string) => setParams(key === shown[0].key ? {} : { tab: key }, { replace: true })}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
        >
          {shown.map(t => (
            <Tab key={t.key} value={t.key} label={t.label} data-testid={`hub-tab-${t.key}`} />
          ))}
        </Tabs>
      )}
      <Box sx={active.fill ? { height: 'calc(100vh - 210px)', minHeight: 480 } : undefined}>{active.element}</Box>
    </Box>
  );
};

/** What needs attention now, and what went wrong before. (Was two pages: Alerts and Fault Logs.) */
export const AlertsHub: React.FC = () => (
  <TabbedPage
    tabs={[
      { key: 'alerts', label: 'Alerts', element: <AlertsView /> },
      { key: 'faults', label: 'Fault history', element: <FaultLogsView /> }
    ]}
  />
);

/** The pumps and starters, how they are doing live, and (for the admin) bringing new ones in from the factory. */
export const DevicesHub: React.FC = () => {
  const { role } = useAuth();
  const viewing = useViewing();
  return (
    <TabbedPage
      tabs={[
        { key: 'devices', label: 'Devices', element: <DevicesView /> },
        { key: 'live', label: 'Live pumps', element: <TelemetryView /> },
        { key: 'factory', label: 'Factory station', element: <FactoryStationView />, hidden: role !== 'manufacturer' || Boolean(viewing) }
      ]}
    />
  );
};
