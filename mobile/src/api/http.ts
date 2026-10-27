import axios, { AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import type { ZodType } from 'zod';
import { API_BASE_URL } from '@/config/env';
import { brand } from '@/config/brand';
import { clearTokens, getAccessToken, getInstallId, getRefreshToken, notifySessionExpired, setTokens } from './session';
import * as contract from './generated/farmer.zod';

export const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  // X-App-Brand tells the server which manufacturer's app this is, so it answers with that manufacturer's data and
  // branding. It selects a view; who the user is and what they may see is still decided by their login.
  headers: { 'Content-Type': 'application/json', 'Bypass-Tunnel-Reminder': 'true', 'X-App-Brand': brand.key },
});

http.interceptors.request.use(async (config) => {
  const token = await getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing: Promise<string | null> | null = null;

async function expireSession(): Promise<null> {
  await clearTokens();
  notifySessionExpired();
  return null;
}

async function doRefresh(): Promise<string | null> {
  const refresh = await getRefreshToken();
  if (!refresh) return expireSession();
  try {
    const res = await axios.post(
      `${API_BASE_URL}/auth/refresh`,
      { refresh_token: refresh, app_install_id: await getInstallId() },
      { timeout: 15000 },
    );
    if (!res.data?.access_token) return expireSession();
    await setTokens(res.data.access_token, res.data.refresh_token);
    return res.data.access_token as string;
  } catch (e) {
    const status = (e as AxiosError).response?.status;
    // The server said no: this session is over. No answer at all (offline, server down)
    // must NOT log the farmer out; the request simply fails and can be retried.
    if (status && status >= 400 && status < 500) return expireSession();
    return null;
  }
}

/** One refresh at a time: refresh tokens rotate, so parallel refreshes would invalidate each other. */
export function refreshAccessToken(): Promise<string | null> {
  if (!refreshing) {
    refreshing = doRefresh().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

type Retriable = InternalAxiosRequestConfig & { _retried?: boolean };

http.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as Retriable | undefined;
    const isAuthCall = /\/auth\/(login-password|refresh)$/.test(original?.url ?? '');
    if (error.response?.status === 401 && original && !original._retried && !isAuthCall) {
      original._retried = true;
      const token = await refreshAccessToken();
      if (token) {
        original.headers.Authorization = `Bearer ${token}`;
        return http(original);
      }
    }
    return Promise.reject(error);
  },
);

/** Raised when the server answers with a shape the app was not built for. */
export class ContractError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly issues: unknown,
  ) {
    super(`Unexpected response from ${endpoint}`);
    this.name = 'ContractError';
  }
}

const CONTRACTS: [string, RegExp, ZodType][] = [
  ['GET', /^\/alerts$/, contract.ListAlertsResponse],
  ['GET', /^\/auth\/me$/, contract.GetMeResponse],
  ['PATCH', /^\/auth\/me$/, contract.UpdateMeResponse],
  ['GET', /^\/auth\/me\/sessions$/, contract.ListSessionsResponse],
  ['GET', /^\/auth\/me\/export$/, contract.ExportMyDataResponse],
  ['GET', /^\/auth\/me\/deletion-request$/, contract.GetDeletionRequestResponse],
  ['POST', /^\/auth\/me\/deletion-request$/, contract.RequestDeletionResponse],
  ['POST', /^\/auth\/login-password$/, contract.LoginWithPasswordResponse],
  ['GET', /^\/pumps$/, contract.ListPumpsResponse],
  ['GET', /^\/pumps\/[^/]+$/, contract.GetPumpResponse],
  ['PATCH', /^\/pumps\/[^/]+\/my-settings$/, contract.UpdatePumpSettingsResponse],
  ['POST', /^\/pumps\/[^/]+\/commands$/, contract.SendPumpCommandResponse],
  ['GET', /^\/pumps\/[^/]+\/commands\/[^/]+$/, contract.GetPumpCommandResponse],
  ['GET', /^\/pumps\/[^/]+\/timer$/, contract.GetPumpTimerResponse],
  ['PUT', /^\/pumps\/[^/]+\/timer$/, contract.SetPumpTimerResponse],
  ['GET', /^\/pumps\/[^/]+\/schedule$/, contract.GetPumpScheduleResponse],
  ['PUT', /^\/pumps\/[^/]+\/schedule$/, contract.SetPumpScheduleResponse],
  ['GET', /^\/pumps\/[^/]+\/history$/, contract.GetPumpHistoryResponse],
  ['GET', /^\/pumps\/[^/]+\/faults$/, contract.ListPumpFaultsResponse],
  ['GET', /^\/pumps\/[^/]+\/support-contact$/, contract.GetSupportContactResponse],
  ['GET', /^\/sites$/, contract.ListSitesResponse],
  ['POST', /^\/sites$/, contract.CreateSiteResponse],
  ['PATCH', /^\/sites\/[^/]+$/, contract.UpdateSiteResponse],
];

/** Checks a response against the schema generated from the backend's OpenAPI contract. */
export function validateResponse(method: string | undefined, url: string | undefined, data: unknown): unknown {
  const path = (url ?? '').split('?')[0];
  const verb = (method ?? 'GET').toUpperCase();
  const hit = CONTRACTS.find(([m, re]) => m === verb && re.test(path));
  if (!hit) return data;
  const parsed = hit[2].safeParse(data);
  if (!parsed.success) {
    if (__DEV__) console.warn(`[contract] ${verb} ${path}`, parsed.error.issues);
    throw new ContractError(`${verb} ${path}`, parsed.error.issues);
  }
  return parsed.data;
}

export type ErrorType<E> = AxiosError<E>;
export type BodyType<B> = B;

/** The mutator orval's generated client calls; `options` carries per-call extras such as an Idempotency-Key header. */
export const httpRequest = async <T>(config: AxiosRequestConfig, options?: AxiosRequestConfig): Promise<T> => {
  const res = await http.request({
    ...config,
    ...options,
    headers: { ...(config.headers ?? {}), ...(options?.headers ?? {}) },
  });
  return validateResponse(config.method, config.url, res.data) as T;
};

export default httpRequest;
