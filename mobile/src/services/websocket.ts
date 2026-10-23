import AsyncStorage from '@react-native-async-storage/async-storage';
import { WS_BASE_URL } from '../config/api';
import { TelemetryData } from '../types';

type TelemetryCallback = (data: TelemetryData) => void;
type ConnectionCallback = (connected: boolean) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private onTelemetryListeners: Set<TelemetryCallback> = new Set();
  private onConnectionListeners: Set<ConnectionCallback> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isConnecting: boolean = false;

  async connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (this.isConnecting) return;
    this.isConnecting = true;

    try {
      const token = await AsyncStorage.getItem('agripump_token');
      const wsUrl = `${WS_BASE_URL}?token=${token || ''}`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnecting = false;
        this.notifyConnection(true);
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'telemetry' || payload.v_ry !== undefined) {
            const telemetry: TelemetryData = payload.data || payload;
            this.notifyTelemetry(telemetry);
          }
        } catch (e) {
          console.warn('WS Message parse error:', e);
        }
      };

      this.ws.onerror = () => {
        this.isConnecting = false;
        this.notifyConnection(false);
      };

      this.ws.onclose = () => {
        this.isConnecting = false;
        this.notifyConnection(false);
        this.scheduleReconnect();
      };
    } catch {
      this.isConnecting = false;
      this.notifyConnection(false);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (!this.reconnectTimer) {
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, 5000);
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.notifyConnection(false);
  }

  onTelemetry(callback: TelemetryCallback) {
    this.onTelemetryListeners.add(callback);
    return () => {
      this.onTelemetryListeners.delete(callback);
    };
  }

  onConnectionChange(callback: ConnectionCallback) {
    this.onConnectionListeners.add(callback);
    return () => {
      this.onConnectionListeners.delete(callback);
    };
  }

  private notifyTelemetry(data: TelemetryData) {
    this.onTelemetryListeners.forEach((fn) => fn(data));
  }

  private notifyConnection(connected: boolean) {
    this.onConnectionListeners.forEach((fn) => fn(connected));
  }
}

export const wsService = new WebSocketService();
