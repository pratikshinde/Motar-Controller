import { create } from 'zustand';

/** Which of the farmer's pumps the Swati screens (home, timer, history, technical details) are about. */
interface SelectedPumpState {
  id: string | null;
  select: (id: string | null) => void;
}

export const useSelectedPump = create<SelectedPumpState>((set) => ({
  id: null,
  select: (id) => set({ id }),
}));
