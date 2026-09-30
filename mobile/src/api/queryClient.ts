import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';

export const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if ((error as Error)?.name === 'ContractError') return false;
  const status = (error as AxiosError)?.response?.status;
  return !(status && status >= 400 && status < 500);
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: CACHE_MAX_AGE_MS,
      // Run once even when offline so saved data is shown instead of a spinner.
      networkMode: 'offlineFirst',
      retry: shouldRetry,
    },
    // A pump command must never sit in a queue and fire minutes later, so mutations never wait for a network.
    mutations: { networkMode: 'always', retry: false },
  },
});

export const persister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'agripump_query_cache',
  throttleTime: 1000,
});

/** Removes everything cached for the signed-in person (memory and disk). */
export async function clearCachedData(): Promise<void> {
  queryClient.clear();
  await persister.removeClient();
}
