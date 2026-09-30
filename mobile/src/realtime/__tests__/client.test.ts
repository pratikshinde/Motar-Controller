import { backoffDelay, CLOSE_UNAUTHORISED, RealtimeClient, RealtimeEvent, RealtimeStatus, SocketLike } from '../client';

class FakeSocket implements SocketLike {
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  sent: string[] = [];
  closed = false;
  constructor(public url: string) {}
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.();
  }
  receive(msg: object) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop(code?: number) {
    this.onclose?.({ code });
  }
  frames() {
    return this.sent.map((s) => JSON.parse(s));
  }
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function setup(opts: { token?: string | null; random?: () => number } = {}) {
  const sockets: FakeSocket[] = [];
  const events: RealtimeEvent[] = [];
  const statuses: RealtimeStatus[] = [];
  const opens: boolean[] = [];
  const getToken = jest.fn(async (force?: boolean) =>
    opts.token === undefined ? (force ? 'fresh' : 'tok') : opts.token,
  );
  const client = new RealtimeClient({
    url: 'ws://server/ws',
    getToken,
    onEvent: (e) => events.push(e),
    onStatus: (s) => statuses.push(s),
    onOpen: (r) => opens.push(r),
    createSocket: (url) => {
      const s = new FakeSocket(url);
      sockets.push(s);
      return s;
    },
    random: opts.random ?? (() => 0.5),
  });
  const connectFully = async (socket: FakeSocket) => {
    socket.open();
    await flush();
    socket.receive({ type: 'auth_ok' });
  };
  return { client, sockets, events, statuses, opens, getToken, connectFully };
}

describe('RealtimeClient', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('opens without a token in the URL and sends the token as the first frame', async () => {
    const { client, sockets } = setup();
    client.start();
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toBe('ws://server/ws');
    expect(sockets[0].url).not.toContain('token');
    sockets[0].open();
    await flush();
    expect(sockets[0].frames()).toEqual([{ type: 'auth', token: 'tok' }]);
  });

  it('is not "open" until the server confirms auth, then subscribes to the pumps it was given', async () => {
    const { client, sockets, statuses, opens, connectFully } = setup();
    client.subscribe(['B', 'A', 'A']);
    client.start();
    sockets[0].open();
    await flush();
    expect(client.getStatus()).toBe('connecting');
    sockets[0].receive({ type: 'auth_ok' });
    expect(client.getStatus()).toBe('open');
    expect(statuses).toContain('open');
    expect(sockets[0].frames()).toContainEqual({ type: 'subscribe', pump_ids: ['A', 'B'] });
    expect(opens).toEqual([false]);
    void connectFully;
  });

  it('replaces the subscription when the pump list changes and never repeats an identical one', async () => {
    const { client, sockets, connectFully } = setup();
    client.start();
    await connectFully(sockets[0]);
    client.subscribe(['A']);
    client.subscribe(['A']);
    client.subscribe(['A', 'C']);
    const subs = sockets[0].frames().filter((f) => f.type === 'subscribe');
    expect(subs.map((f) => f.pump_ids)).toEqual([['A'], ['A', 'C']]);
  });

  it('passes server events on and ignores junk', async () => {
    const { client, sockets, events, connectFully } = setup();
    client.start();
    await connectFully(sockets[0]);
    sockets[0].receive({ type: 'telemetry', pump_id: 'P1', data: { v_ry: 410 } });
    sockets[0].receive({ type: 'fault', pump_id: 'P1', data: { code: 2 } });
    sockets[0].receive({ type: 'mystery', pump_id: 'P1' });
    sockets[0].onmessage?.({ data: 'not json' });
    expect(events.map((e) => e.type)).toEqual(['telemetry', 'fault']);
    expect(events[0]).toMatchObject({ pumpId: 'P1', data: { v_ry: 410 } });
  });

  it('pings every 25 s and reconnects when no pong arrives', async () => {
    const { client, sockets, connectFully } = setup();
    client.start();
    await connectFully(sockets[0]);
    jest.advanceTimersByTime(25_000);
    expect(sockets[0].frames().filter((f) => f.type === 'ping')).toHaveLength(1);
    sockets[0].receive({ type: 'pong' });
    jest.advanceTimersByTime(10_000); // the pong arrived, so this must not drop the link
    expect(sockets).toHaveLength(1);

    jest.advanceTimersByTime(15_000); // second ping at 50 s...
    jest.advanceTimersByTime(10_000); // ...never answered
    expect(client.getStatus()).toBe('reconnecting');
    jest.advanceTimersByTime(30_000);
    await flush();
    expect(sockets.length).toBeGreaterThan(1);
  });

  it('backs off exponentially with jitter between attempts and resets after a good connection', async () => {
    const { client, sockets, connectFully } = setup({ random: () => 0 });
    client.start();
    expect(sockets).toHaveLength(1);
    sockets[0].drop(1006);
    jest.advanceTimersByTime(499);
    expect(sockets).toHaveLength(1); // first retry waits >= 500 ms (half of 1 s)
    jest.advanceTimersByTime(1);
    await flush();
    expect(sockets).toHaveLength(2);
    sockets[1].drop(1006);
    jest.advanceTimersByTime(999);
    expect(sockets).toHaveLength(2); // second waits >= 1 s
    jest.advanceTimersByTime(1);
    await flush();
    expect(sockets).toHaveLength(3);

    await connectFully(sockets[2]); // success: the delay starts over
    sockets[2].drop(1006);
    jest.advanceTimersByTime(500);
    await flush();
    expect(sockets).toHaveLength(4);
  });

  it('backoffDelay grows, is capped, and keeps at least half the ceiling', () => {
    expect(backoffDelay(0, 1000, 30_000, () => 0)).toBe(500);
    expect(backoffDelay(0, 1000, 30_000, () => 1)).toBe(1000);
    expect(backoffDelay(3, 1000, 30_000, () => 1)).toBe(8000);
    expect(backoffDelay(20, 1000, 30_000, () => 1)).toBe(30_000);
    expect(backoffDelay(20, 1000, 30_000, () => 0)).toBe(15_000);
  });

  it('gets a fresh token before reconnecting after the server refuses the old one (4401)', async () => {
    const { client, sockets, getToken, connectFully } = setup({ random: () => 0 });
    client.start();
    await connectFully(sockets[0]);
    sockets[0].drop(CLOSE_UNAUTHORISED);
    jest.advanceTimersByTime(500);
    await flush();
    expect(getToken).toHaveBeenCalledWith(true);
    expect(sockets).toHaveLength(2);
  });

  it('pauses (drops the socket, stops retrying) in the background and reconnects at once on resume', async () => {
    const { client, sockets, connectFully } = setup();
    client.start();
    await connectFully(sockets[0]);
    client.pause();
    expect(client.getStatus()).toBe('paused');
    expect(sockets[0].closed).toBe(true);
    jest.advanceTimersByTime(120_000);
    expect(sockets).toHaveLength(1);
    client.resume();
    await flush();
    expect(sockets).toHaveLength(2);
  });

  it('a reconnect is reported so the app can refetch what it missed', async () => {
    const { client, sockets, opens, connectFully } = setup({ random: () => 0 });
    client.start();
    await connectFully(sockets[0]);
    sockets[0].drop(1006);
    jest.advanceTimersByTime(500);
    await flush();
    await connectFully(sockets[1]);
    expect(opens).toEqual([false, true]);
  });

  it('stops for good when there is no token (signed out)', async () => {
    const { client, sockets } = setup({ token: null });
    client.start();
    sockets[0].open();
    await flush();
    expect(client.getStatus()).toBe('idle');
    jest.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
  });

  it('gives up on a socket that never answers the auth frame and retries', async () => {
    const { client, sockets } = setup({ random: () => 0 });
    client.start();
    sockets[0].open();
    await flush();
    jest.advanceTimersByTime(8_000);
    expect(client.getStatus()).toBe('reconnecting');
    jest.advanceTimersByTime(500);
    await flush();
    expect(sockets).toHaveLength(2);
  });

  it('ignores late events from a socket it has already replaced', async () => {
    const { client, sockets, events, connectFully } = setup({ random: () => 0 });
    client.start();
    await connectFully(sockets[0]);
    client.pause();
    client.resume();
    await flush();
    sockets[0].receive({ type: 'telemetry', pump_id: 'P1', data: {} });
    expect(events).toHaveLength(0);
  });
});
