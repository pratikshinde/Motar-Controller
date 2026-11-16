import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TOKEN = 'agripump_token';
const REFRESH = 'agripump_refresh';
const USER = 'agripump_user';

const json = (status: number, body: any = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const renewed = { access_token: 'access-2', refresh_token: 'refresh-2' };

let fetchMock: ReturnType<typeof vi.fn>;
let expired: ReturnType<typeof vi.fn>;

async function load() {
  vi.resetModules();
  return await import('../client');
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(TOKEN, 'access-1');
  localStorage.setItem(REFRESH, 'refresh-1');
  localStorage.setItem(USER, JSON.stringify({ id: 'u1', full_name: 'Someone', role: 'manufacturer' }));
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  expired = vi.fn();
  window.addEventListener('agripump:session-expired', expired);
});

afterEach(() => {
  window.removeEventListener('agripump:session-expired', expired);
  vi.unstubAllGlobals();
});

describe('staying signed in: the session is renewed quietly, and only a really ended session signs the person out', () => {
  it('renews an expired access token and repeats the request: the person never notices', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401)) // the request with the expired access token
      .mockResolvedValueOnce(json(200, renewed)) // the renewal
      .mockResolvedValueOnce(json(200, { ok: true })); // the request again
    const { apiFetch } = await load();
    const res = await apiFetch('/pumps');
    expect(res.status).toBe(200);
    expect(localStorage.getItem(TOKEN)).toBe('access-2');
    expect(localStorage.getItem(REFRESH)).toBe('refresh-2');
    expect(expired).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer access-2');
  });

  it('does not sign anyone out when the server is busy or restarting while renewing', async () => {
    fetchMock.mockResolvedValueOnce(json(401)).mockResolvedValueOnce(json(502));
    const { apiFetch } = await load();
    const res = await apiFetch('/pumps');
    expect(res.status).toBe(401);
    expect(localStorage.getItem(TOKEN)).toBe('access-1');
    expect(localStorage.getItem(REFRESH)).toBe('refresh-1');
    expect(expired).not.toHaveBeenCalled();
  });

  it('does not sign anyone out when there is no network while renewing', async () => {
    fetchMock.mockResolvedValueOnce(json(401)).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { apiFetch } = await load();
    await apiFetch('/pumps');
    expect(localStorage.getItem(TOKEN)).toBe('access-1');
    expect(expired).not.toHaveBeenCalled();
  });

  it('signs out only when the server says the session is really over', async () => {
    fetchMock.mockResolvedValueOnce(json(401)).mockResolvedValueOnce(json(401, { detail: 'Invalid or expired refresh token' }));
    const { apiFetch } = await load();
    await apiFetch('/pumps');
    expect(localStorage.getItem(TOKEN)).toBeNull();
    expect(localStorage.getItem(REFRESH)).toBeNull();
    expect(expired).toHaveBeenCalled();
  });

  it('uses the newest key when another tab renewed the session a moment ago: no second renewal, no sign-out', async () => {
    const { apiFetch } = await load();
    fetchMock.mockImplementationOnce(async () => {
      // while this request was in flight another tab renewed and stored the new pair
      localStorage.setItem(TOKEN, 'access-other-tab');
      localStorage.setItem(REFRESH, 'refresh-other-tab');
      return json(401);
    });
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    const res = await apiFetch('/pumps');
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2); // the request and its repeat: no call to /auth/refresh
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer access-other-tab');
    expect(expired).not.toHaveBeenCalled();
  });

  it('retries with the newer key when the renewal loses a race with another tab', async () => {
    const { apiFetch } = await load();
    fetchMock.mockResolvedValueOnce(json(401)); // the request
    fetchMock.mockImplementationOnce(async () => {
      // our renewal key had just been replaced by another tab, which has stored the new one
      localStorage.setItem(REFRESH, 'refresh-other-tab');
      return json(401, { detail: 'This refresh token was just replaced by a newer one.' });
    });
    fetchMock.mockResolvedValueOnce(json(200, renewed)); // renewal with the newer key
    fetchMock.mockResolvedValueOnce(json(200, { ok: true })); // the request again
    const res = await apiFetch('/pumps');
    expect(res.status).toBe(200);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).refresh_token).toBe('refresh-other-tab');
    expect(expired).not.toHaveBeenCalled();
  });

  it('many requests that fail together share one renewal', async () => {
    fetchMock.mockImplementation(async (url: string, init: any) => {
      if (String(url).endsWith('/auth/refresh')) return json(200, renewed);
      return init.headers.Authorization === 'Bearer access-2' ? json(200, { ok: true }) : json(401);
    });
    const { apiFetch } = await load();
    const results = await Promise.all([apiFetch('/a'), apiFetch('/b'), apiFetch('/c'), apiFetch('/d')]);
    expect(results.map(r => r.status)).toEqual([200, 200, 200, 200]);
    expect(fetchMock.mock.calls.filter(c => String(c[0]).endsWith('/auth/refresh'))).toHaveLength(1);
  });

  it('signing out in another tab signs this one out too', async () => {
    await load();
    localStorage.removeItem(TOKEN);
    localStorage.removeItem(REFRESH);
    window.dispatchEvent(new StorageEvent('storage', { key: TOKEN, oldValue: 'access-1', newValue: null }));
    expect(expired).toHaveBeenCalled();
  });

  it('a sign-in that is refused is not mistaken for an expired session', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { detail: 'Incorrect email or password.' }));
    const { apiFetch } = await load();
    const res = await apiFetch('/auth/login-email', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(TOKEN)).toBe('access-1');
  });

  it('remembers each role session independently until that role explicitly logs out', async () => {
    const { saveRoleSession, activateRoleSession, clearSession } = await load();
    const superAdmin = { id: 'sa-1', full_name: 'Super Admin', role: 'superadmin' as const, phone_number: '', hierarchy_path: '/SA' };
    const admin = { id: 'm-1', full_name: 'Ajanta Admin', role: 'manufacturer' as const, phone_number: '', hierarchy_path: '/SA/m-1' };

    saveRoleSession('sa-token', 'sa-refresh', superAdmin);
    saveRoleSession('admin-token', 'admin-refresh', admin);

    // Switching to Super Admin (lock button) restores Super Admin without re-login
    const restoredSa = activateRoleSession('superadmin');
    expect(restoredSa?.token).toBe('sa-token');
    expect(localStorage.getItem(TOKEN)).toBe('sa-token');

    // Switching to Admin restores Admin without wiping Super Admin
    const restoredAdmin = activateRoleSession('manufacturer');
    expect(restoredAdmin?.token).toBe('admin-token');
    expect(localStorage.getItem(TOKEN)).toBe('admin-token');

    // Explicit logout of Admin clears Admin's session, while Super Admin stays remembered
    clearSession(true);
    expect(activateRoleSession('manufacturer')).toBeNull();
    expect(activateRoleSession('superadmin')?.token).toBe('sa-token');
  });
});
