import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { WS_URL } from '@/config/env';
import { getAccessToken } from '@/api/session';
import { refreshAccessToken } from '@/api/http';
import { useListPumps } from '@/api/generated/farmer';
import { useAuth } from '@/state/auth';
import { applyRealtimeEvent } from './apply';
import { RealtimeClient, RealtimeStatus } from './client';

interface RealtimeContextValue {
  status: RealtimeStatus;
}

const RealtimeContext = createContext<RealtimeContextValue>({ status: 'idle' });
export const useRealtimeStatus = (): RealtimeStatus => useContext(RealtimeContext).status;

/** Keeps one live connection while signed in, and folds its events into the query cache. */
export const RealtimeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const signedIn = useAuth((s) => s.status === 'signedIn');
  const qc = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>('idle');
  const clientRef = useRef<RealtimeClient | null>(null);

  useEffect(() => {
    if (!signedIn) return undefined;
    const client = new RealtimeClient({
      url: WS_URL,
      getToken: async (forceRefresh) => (forceRefresh ? await refreshAccessToken() : await getAccessToken()),
      onStatus: setStatus,
      onEvent: (event) => applyRealtimeEvent(qc, event),
      // After a gap, anything that happened while disconnected is fetched again.
      onOpen: (reconnect) => {
        if (reconnect) void qc.invalidateQueries();
      },
    });
    clientRef.current = client;
    client.start();

    const sub =
      Platform.OS === 'web'
        ? null
        : AppState.addEventListener('change', (next) => (next === 'active' ? client.resume() : client.pause()));

    return () => {
      sub?.remove();
      client.stop();
      clientRef.current = null;
      setStatus('idle');
    };
  }, [signedIn, qc]);

  const value = useMemo(() => ({ status }), [status]);
  return (
    <RealtimeContext.Provider value={value}>
      {signedIn ? <PumpSubscriptions clientRef={clientRef} status={status} /> : null}
      {children}
    </RealtimeContext.Provider>
  );
};

/** Subscribes the connection to exactly the pumps in the farmer's list. */
const PumpSubscriptions: React.FC<{
  clientRef: React.MutableRefObject<RealtimeClient | null>;
  status: RealtimeStatus;
}> = ({ clientRef, status }) => {
  const { data } = useListPumps();
  const ids = useMemo(() => (data?.pumps ?? []).map((p) => p.id), [data]);
  const key = ids.join(',');
  useEffect(() => {
    clientRef.current?.subscribe(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, status, clientRef]);
  return null;
};
