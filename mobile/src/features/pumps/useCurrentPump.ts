import { useListPumps } from '@/api/generated/farmer';
import type { PumpResponse } from '@/api/generated/model';
import { useSelectedPump } from '@/state/selectedPump';

/**
 * The pump the Swati screens are about: the one the farmer picked in "My pumps", else their first. A pump that no longer
 * exists (removed, or another account signed in) falls back to the first one rather than showing nothing.
 */
export function useCurrentPump(): {
  pump: PumpResponse | undefined;
  pumps: PumpResponse[];
  loading: boolean;
  failed: boolean;
  refetch: () => void;
} {
  const q = useListPumps();
  const selected = useSelectedPump((s) => s.id);
  const pumps = q.data?.pumps ?? [];
  const pump = pumps.find((p) => p.id === selected) ?? pumps[0];
  return {
    pump,
    pumps,
    loading: q.isLoading && !q.data,
    failed: q.isError && !q.data,
    refetch: () => void q.refetch(),
  };
}
