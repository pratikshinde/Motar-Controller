import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { getAuthToken } from '../api/client';
import { useAuth } from './AuthContext';

export type WsStatus = 'connecting' | 'open' | 'closed';

type MessageType = 'pump_update' | 'fault' | 'config_update' | 'alert' | 'alert_digest';
type Listener = (payload: any) => void;

interface WebSocketContextValue {
  status: WsStatus;
  lastMessageAt: Date | null;
  subscribe: (type: MessageType, cb: Listener) => () => void;
}

const WebSocketCtx = createContext<WebSocketContextValue | null>(null);

const WS_URL = 'ws://localhost:5000/ws';
const MAX_BACKOFF_MS = 15000;

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const [status, setStatus] = useState<WsStatus>('closed');
  const [lastMessageAt, setLastMessageAt] = useState<Date | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Map<MessageType, Set<Listener>>>(new Map());
  const backoffRef = useRef(1000);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingRef = useRef(false);

  const subscribe = useCallback((type: MessageType, cb: Listener) => {
    if (!listenersRef.current.has(type)) listenersRef.current.set(type, new Set());
    listenersRef.current.get(type)!.add(cb);
    return () => {
      listenersRef.current.get(type)?.delete(cb);
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      closingRef.current = true;
      wsRef.current?.close();
      wsRef.current = null;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      setStatus('closed');
      return;
    }

    closingRef.current = false;

    function connect() {
      const token = getAuthToken();
      if (!token) return;

      setStatus('connecting');
      const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        backoffRef.current = 1000;
      };

      ws.onmessage = event => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'connected') {
            setStatus('open');
            setLastMessageAt(new Date());
            return;
          }
          if (msg.type === 'pump_update' || msg.type === 'fault' || msg.type === 'config_update' || msg.type === 'alert' || msg.type === 'alert_digest') {
            setLastMessageAt(new Date());
            listenersRef.current.get(msg.type)?.forEach(cb => cb(msg));
          }
        } catch {
          // Malformed frame — ignore rather than crash the socket handler.
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (closingRef.current) return;
        setStatus('connecting');
        reconnectTimerRef.current = setTimeout(connect, backoffRef.current);
        backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      closingRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [isAuthenticated]);

  return <WebSocketCtx.Provider value={{ status, lastMessageAt, subscribe }}>{children}</WebSocketCtx.Provider>;
};

export function useWs() {
  const ctx = useContext(WebSocketCtx);
  if (!ctx) throw new Error('useWs must be used within WebSocketProvider');
  return ctx;
}
