export type PumpState = 'OFF' | 'STARTING' | 'RUNNING' | 'TRIPPED' | 'UNKNOWN';

export interface TelemetryData {
  device_id: string;
  timestamp: string;
  pump_state: PumpState;
  fault_code: number;
  fault_name?: string;
  v_ry: number;
  v_yb: number;
  v_br: number;
  i_r: number;
  i_y: number;
  i_b: number;
  pf: number;
  freq: number;
  signal_dbm?: number;
  run_hours?: number;
  motor_hp?: number;
}

export interface Device {
  id: string;
  name: string;
  device_id: string;
  status: 'ONLINE' | 'OFFLINE' | 'ALERT';
  pump_state: PumpState;
  fault_code: number;
  motor_hp: number;
  phase_type: '3P' | '1P';
  location?: string;
  last_telemetry_at?: string;
}

export interface Alert {
  id: string;
  device_id: string;
  fault_code: number;
  fault_name: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  status: 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED';
  created_at: string;
  message: string;
}

export interface User {
  id: string;
  phone: string;
  name: string;
  role: string;
  organization_id?: string;
}

export interface AuthState {
  token: string | null;
  refreshToken: string | null;
  user: User | null;
  isAuthenticated: boolean;
}
