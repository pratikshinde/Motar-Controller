import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';

/** 'light' icons over the green bar, 'dark' over the pale background. Applied while the screen is focused. */
export function useStatusBar(style: 'light' | 'dark'): void {
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle(style);
    }, [style]),
  );
}
