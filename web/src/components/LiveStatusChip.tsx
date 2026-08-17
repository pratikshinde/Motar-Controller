import React, { useState, useEffect } from 'react';
import { Chip, Tooltip } from '@mui/material';
import WifiIcon from '@mui/icons-material/Wifi';
import WifiOffIcon from '@mui/icons-material/WifiOff';
import type { WsStatus } from '../context/WebSocketContext';

const STALE_AFTER_MS = 90000;

function timeAgo(d: Date) {
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  return `${min}m ago`;
}

// FR-WEB-005: "a visible 'last updated' and stale-data indicator" — this
// is that indicator, driven by the WebSocket connection state plus the
// timestamp of the last message actually received (not just "connected").
export const LiveStatusChip: React.FC<{ status: WsStatus; lastUpdated: Date | null }> = ({ status, lastUpdated }) => {
  const [, forceTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => forceTick(n => n + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const isStale = !lastUpdated || Date.now() - lastUpdated.getTime() > STALE_AFTER_MS || status !== 'open';

  const label = status !== 'open' ? 'Reconnecting…' : lastUpdated ? `Live · updated ${timeAgo(lastUpdated)}` : 'Live';

  return (
    <Tooltip title={status === 'open' ? 'Connected — updates arrive automatically' : 'Connection lost — retrying'}>
      <Chip
        size="small"
        icon={status === 'open' ? <WifiIcon fontSize="small" /> : <WifiOffIcon fontSize="small" />}
        label={label}
        color={isStale ? 'warning' : 'success'}
        variant={isStale ? 'outlined' : 'filled'}
      />
    </Tooltip>
  );
};
