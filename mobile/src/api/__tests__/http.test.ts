import axios, { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { ContractError, http, refreshAccessToken, validateResponse } from '../http';
import { clearTokens, getAccessToken, getRefreshToken, onSessionExpired, setTokens } from '../session';

const ok = (config: InternalAxiosRequestConfig, data: unknown, status = 200): AxiosResponse => ({
  data,
  status,
  statusText: '',
  headers: {},
  config,
});

const reject = (config: InternalAxiosRequestConfig, status: number) =>
  Promise.reject(
    Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, config, response: ok(config, {}, status) }),
  );

describe('response contract', () => {
  beforeEach(() => void jest.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  const pumpList = { pumps: [], data: [], meta: { total: 0, limit: 50 } };

  it('passes a response that matches the generated schema through', () => {
    expect(validateResponse('GET', '/pumps', pumpList)).toEqual(pumpList);
  });

  it('rejects a response that has drifted (missing a required field) instead of rendering blanks', () => {
    expect(() => validateResponse('GET', '/pumps', { pumps: [] })).toThrow(ContractError);
    try {
      validateResponse('GET', '/pumps', { pumps: [] });
    } catch (e) {
      expect((e as ContractError).endpoint).toBe('GET /pumps');
    }
  });

  it('ignores endpoints it has no schema for, and matches the method', () => {
    expect(validateResponse('GET', '/pumps/P1/history.csv', 'a,b')).toBe('a,b');
    expect(validateResponse('DELETE', '/pumps', 'anything')).toBe('anything');
  });
});

describe('token refresh', () => {
  const original = http.defaults.adapter;
  afterEach(async () => {
    http.defaults.adapter = original;
    jest.restoreAllMocks();
    await clearTokens();
  });

  it('two calls that both get a 401 share ONE refresh, then both succeed with the new token', async () => {
    await setTokens('old-access', 'old-refresh');
    const refresh = jest
      .spyOn(axios, 'post')
      .mockResolvedValue({ data: { access_token: 'new-access', refresh_token: 'new-refresh' } });
    const seen: string[] = [];
    http.defaults.adapter = ((config: InternalAxiosRequestConfig) => {
      const auth = String(config.headers.Authorization);
      seen.push(auth);
      return auth === 'Bearer new-access' ? Promise.resolve(ok(config, { fine: true })) : reject(config, 401);
    }) as AxiosAdapter;

    const [a, b] = await Promise.all([http.get('/anything'), http.get('/else')]);
    expect(a.data).toEqual({ fine: true });
    expect(b.data).toEqual({ fine: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await getAccessToken()).toBe('new-access');
    expect(await getRefreshToken()).toBe('new-refresh'); // refresh tokens rotate: the new one is kept
  });

  it('a refused refresh ends the session and tells the app', async () => {
    await setTokens('old-access', 'dead-refresh');
    jest.spyOn(axios, 'post').mockRejectedValue({ response: { status: 401 } });
    const expired = jest.fn();
    const off = onSessionExpired(expired);
    http.defaults.adapter = ((config: InternalAxiosRequestConfig) => reject(config, 401)) as AxiosAdapter;

    await expect(http.get('/anything')).rejects.toBeTruthy();
    expect(expired).toHaveBeenCalledTimes(1);
    expect(await getAccessToken()).toBeNull();
    off();
  });

  it('being offline during a refresh does NOT log the farmer out', async () => {
    await setTokens('old-access', 'still-good');
    jest.spyOn(axios, 'post').mockRejectedValue(new Error('Network Error')); // no response at all
    const expired = jest.fn();
    const off = onSessionExpired(expired);
    http.defaults.adapter = ((config: InternalAxiosRequestConfig) => reject(config, 401)) as AxiosAdapter;

    await expect(http.get('/anything')).rejects.toBeTruthy();
    expect(expired).not.toHaveBeenCalled();
    expect(await getRefreshToken()).toBe('still-good');
    off();
  });

  it('never tries to refresh for the login call itself', async () => {
    const refresh = jest.spyOn(axios, 'post');
    http.defaults.adapter = ((config: InternalAxiosRequestConfig) => reject(config, 401)) as AxiosAdapter;
    await expect(http.post('/auth/login-password', {})).rejects.toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshAccessToken without a stored refresh token expires the session', async () => {
    await clearTokens();
    const expired = jest.fn();
    const off = onSessionExpired(expired);
    expect(await refreshAccessToken()).toBeNull();
    expect(expired).toHaveBeenCalled();
    off();
  });
});
