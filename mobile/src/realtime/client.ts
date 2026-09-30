/**
 * Live connection to the server (planner P3.4).
 *
 *  - Auth-first: the socket opens with no token in the URL (URLs end up in proxy logs); the first
 *    frame is `{type:'auth', token}` and nothing is trusted until the server answers `auth_ok`.
 *  - One subscription per pump the farmer can see (`subscribe` replaces the whole set).
 *  - Reconnects with exponential backoff and jitter, so a server restart is not followed by every
 *    phone reconnecting in the same second.
 *  - Heartbeat: a ping every 25 s; no pong within 10 s means the link is dead even if the OS has
 *    not noticed, so it is dropped and re-opened.
 *  - `pause()` / `resume()` for the app going to the background (a background socket only drains
 *    the battery), with an immediate reconnect on resume.
 */
export type RealtimeStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'paused';

export type RealtimeEvent =
  | { type: 'telemetry'; pumpId: string; data: Record<string, unknown> }
  | { type: 'fault'; pumpId: string; data: Record<string, unknown> }
  | { type: 'config'; pumpId: string; data: Record<string, unknown> }
  | { type: 'command'; pumpId: string; data: Record<string, unknown> };

export interface SocketLike {
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number }) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface RealtimeOptions {
  url: string;
  /** Returns a usable access token, refreshing it first when `forceRefresh` is set. Null = signed out. */
  getToken: (forceRefresh?: boolean) => Promise<string | null>;
  onEvent: (event: RealtimeEvent) => void;
  onStatus?: (status: RealtimeStatus) => void;
  /** Called after every successful (re)connection; `reconnect` is false only for the first one. */
  onOpen?: (reconnect: boolean) => void;
  createSocket?: (url: string) => SocketLike;
  heartbeatMs?: number;
  pongTimeoutMs?: number;
  authTimeoutMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
}

const EVENT_TYPES = new Set(['telemetry', 'fault', 'config', 'command']);
export const CLOSE_UNAUTHORISED = 4401;

export function backoffDelay(attempt: number, baseMs: number, maxMs: number, random: () => number): number {
  const cap = Math.min(maxMs, baseMs * 2 ** attempt);
  // "Equal jitter": at least half the cap, so retries still back off, plus a random share of the rest.
  return Math.round(cap / 2 + random() * (cap / 2));
}

export class RealtimeClient {
  private readonly o: Required<Omit<RealtimeOptions, 'onStatus' | 'onOpen'>> &
    Pick<RealtimeOptions, 'onStatus' | 'onOpen'>;
  private socket: SocketLike | null = null;
  private status: RealtimeStatus = 'idle';
  private wanted = false;
  private paused = false;
  private attempt = 0;
  private everOpened = false;
  private pumpIds: string[] = [];
  private lastSentIds = '';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private authTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;

  constructor(options: RealtimeOptions) {
    this.o = {
      heartbeatMs: 25_000,
      pongTimeoutMs: 10_000,
      authTimeoutMs: 8_000,
      baseDelayMs: 1_000,
      maxDelayMs: 30_000,
      random: Math.random,
      createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
      ...options,
    };
  }

  getStatus(): RealtimeStatus {
    return this.status;
  }

  start(): void {
    this.wanted = true;
    this.paused = false;
    if (!this.socket && !this.reconnectTimer) void this.connect();
  }

  stop(): void {
    this.wanted = false;
    this.paused = false;
    this.teardown();
    this.setStatus('idle');
  }

  pause(): void {
    if (!this.wanted || this.paused) return;
    this.paused = true;
    this.teardown();
    this.setStatus('paused');
  }

  resume(): void {
    if (!this.wanted || !this.paused) return;
    this.paused = false;
    this.attempt = 0;
    void this.connect();
  }

  /** Replaces the set of pumps to receive live updates for. */
  subscribe(pumpIds: string[]): void {
    this.pumpIds = [...new Set(pumpIds)].sort();
    this.sendSubscription();
  }

  private setStatus(next: RealtimeStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.o.onStatus?.(next);
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    if (this.authTimer) clearTimeout(this.authTimer);
    this.reconnectTimer = this.heartbeatTimer = this.pongTimer = this.authTimer = null;
  }

  private teardown(): void {
    this.generation += 1; // events from the old socket are ignored from here on
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    this.lastSentIds = '';
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      try {
        socket.close(1000);
      } catch {
        // already closed
      }
    }
  }

  private async connect(): Promise<void> {
    if (!this.wanted || this.paused || this.socket) return;
    this.setStatus(this.attempt === 0 && !this.everOpened ? 'connecting' : 'reconnecting');
    const gen = ++this.generation;
    let socket: SocketLike;
    try {
      socket = this.o.createSocket(this.o.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      if (gen !== this.generation) return;
      void this.authenticate(gen, false);
    };
    socket.onmessage = (ev) => {
      if (gen !== this.generation) return;
      this.handleMessage(String(ev.data), gen);
    };
    socket.onerror = () => undefined; // onclose always follows
    socket.onclose = (ev) => {
      if (gen !== this.generation) return;
      this.handleClosed(ev?.code);
    };
  }

  private async authenticate(gen: number, forceRefresh: boolean): Promise<void> {
    const token = await this.o.getToken(forceRefresh);
    if (gen !== this.generation) return;
    if (!token) {
      this.stop(); // signed out: nothing to connect as
      return;
    }
    this.socket?.send(JSON.stringify({ type: 'auth', token }));
    this.authTimer = setTimeout(() => {
      if (gen === this.generation) this.handleClosed(undefined);
    }, this.o.authTimeoutMs);
  }

  private handleMessage(raw: string, gen: number): void {
    let msg: { type?: string; pump_id?: string; data?: Record<string, unknown> };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === 'auth_ok') {
      if (this.authTimer) clearTimeout(this.authTimer);
      this.authTimer = null;
      const reconnect = this.everOpened;
      this.everOpened = true;
      this.attempt = 0;
      this.setStatus('open');
      this.lastSentIds = '';
      this.sendSubscription();
      this.startHeartbeat(gen);
      this.o.onOpen?.(reconnect);
    } else if (msg.type === 'pong') {
      if (this.pongTimer) clearTimeout(this.pongTimer);
      this.pongTimer = null;
    } else if (msg.type && EVENT_TYPES.has(msg.type) && msg.pump_id) {
      this.o.onEvent({ type: msg.type, pumpId: msg.pump_id, data: msg.data ?? {} } as RealtimeEvent);
    }
  }

  private sendSubscription(): void {
    if (this.status !== 'open' || !this.socket) return;
    const key = this.pumpIds.join(',');
    if (key === this.lastSentIds) return;
    this.lastSentIds = key;
    this.socket.send(JSON.stringify({ type: 'subscribe', pump_ids: this.pumpIds }));
  }

  private startHeartbeat(gen: number): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (gen !== this.generation || !this.socket) return;
      try {
        this.socket.send(JSON.stringify({ type: 'ping' }));
      } catch {
        this.handleClosed(undefined);
        return;
      }
      if (this.pongTimer) clearTimeout(this.pongTimer);
      this.pongTimer = setTimeout(() => {
        if (gen === this.generation) this.handleClosed(undefined);
      }, this.o.pongTimeoutMs);
    }, this.o.heartbeatMs);
  }

  private handleClosed(code: number | undefined): void {
    this.teardown();
    if (!this.wanted || this.paused) return;
    if (code === CLOSE_UNAUTHORISED) {
      // The access token was refused: get a fresh one before the next attempt.
      this.scheduleReconnect(true);
      return;
    }
    this.scheduleReconnect(false);
  }

  private scheduleReconnect(refreshToken = false): void {
    if (!this.wanted || this.paused) return;
    this.setStatus('reconnecting');
    const delay = backoffDelay(this.attempt, this.o.baseDelayMs, this.o.maxDelayMs, this.o.random);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (refreshToken) {
        void this.o.getToken(true).then(() => this.connect());
      } else {
        void this.connect();
      }
    }, delay);
  }
}
