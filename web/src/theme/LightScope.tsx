import React, { useMemo } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { buildAppTheme } from './index';

/**
 * Renders its children with the light theme, whatever mode the rest of the app is in.
 *
 * The public pages (landing, sign-in, create account) are drawn on a fixed light palette. Without this, a visitor whose
 * system is set to dark gets the dark theme's MUI tokens on top of that palette: near-white text typed into white input
 * boxes, dark alert panels on a white page.
 */
export const LightScope: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const theme = useMemo(() => buildAppTheme('light'), []);
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
};
