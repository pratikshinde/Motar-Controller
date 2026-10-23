import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppThemeProvider } from './theme/ColorModeContext';
import { ToastProvider } from './context/ToastContext';
import { LocaleProvider } from './context/LocaleContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { BrandingProvider } from './context/BrandingContext';
import { WebSocketProvider } from './context/WebSocketContext';
import { AppShell } from './components/AppShell';
import { LoginView } from './views/LoginView';
import { TelemetryView } from './views/TelemetryView';
import { DevicesView } from './views/DevicesView';
import { HierarchyView } from './views/HierarchyView';
import { FaultLogsView } from './views/FaultLogsView';
import { MapView } from './views/MapView';
import { DeviceDetailView } from './views/DeviceDetailView';
import { AuditLogView } from './views/AuditLogView';
import { FleetDashboardView } from './views/FleetDashboardView';
import { FactoryConsoleView } from './views/FactoryConsoleView';
import { SystemHealthView } from './views/SystemHealthView';
import { SupportConsoleView } from './views/SupportConsoleView';
import { InviteRedeemView } from './views/InviteRedeemView';
import { ConfigTemplatesView } from './views/ConfigTemplatesView';
import { ServiceReportsView } from './views/ServiceReportsView';
import { AlertsView } from './views/AlertsView';
import { LandingPageView } from './views/landing/LandingPageView';
import { LightScope } from './theme/LightScope';

// The public pages are drawn on a fixed light palette, so they always render with the light theme.
const publicPage = (page: React.ReactElement) => <LightScope>{page}</LightScope>;

const AuthenticatedApp: React.FC = () => (
  <Routes>
    <Route element={<AppShell />}>
      <Route path="/dashboard" element={<TelemetryView />} />
      <Route path="/telemetry" element={<TelemetryView />} />
      <Route path="/fleet" element={<FleetDashboardView />} />
      <Route path="/devices" element={<DevicesView />} />
      <Route path="/devices/:id" element={<DeviceDetailView />} />
      <Route path="/hierarchy" element={<HierarchyView />} />
      <Route path="/faults" element={<FaultLogsView />} />
      <Route path="/map" element={<MapView />} />
      <Route path="/config-templates" element={<ConfigTemplatesView />} />
      <Route path="/service-reports" element={<ServiceReportsView />} />
      <Route path="/alerts" element={<AlertsView />} />
      <Route path="/audit" element={<AuditLogView />} />
      <Route path="/factory" element={<FactoryConsoleView />} />
      <Route path="/health" element={<SystemHealthView />} />
      <Route path="/support" element={<SupportConsoleView />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Route>
  </Routes>
);

// /invite/:token (FR-WEB-035) must be reachable with no session at all —
// that's the whole point of a self-registration link — so it's matched
// before the auth gate rather than nested inside AuthenticatedApp.
const Gate: React.FC = () => {
  const { isAuthenticated } = useAuth();
  return (
    <Routes>
      <Route path="/" element={publicPage(<LandingPageView />)} />

      {/* Authentication & Onboarding Portal */}
      <Route path="/login" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : publicPage(<LoginView defaultTab="login" />)} />
      <Route path="/auth/login" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : publicPage(<LoginView defaultTab="login" />)} />
      <Route path="/register" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : publicPage(<LoginView defaultTab="register" />)} />
      <Route path="/auth/register" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : publicPage(<LoginView defaultTab="register" />)} />
      <Route path="/auth/register/*" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : publicPage(<LoginView defaultTab="register" />)} />
      <Route path="/auth/verify-otp" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : publicPage(<LoginView defaultTab="login" />)} />
      <Route path="/auth/mfa" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : publicPage(<LoginView defaultTab="login" />)} />

      {/* Invite Redemption Token */}
      <Route path="/invite/:token" element={<InviteRedeemView />} />

      {/* Protected Dashboard */}
      <Route path="/*" element={isAuthenticated ? <AuthenticatedApp /> : <Navigate to="/login" replace />} />
    </Routes>
  );
};

export const App: React.FC = () => (
  <AppThemeProvider>
    <ToastProvider>
      <LocaleProvider>
        <AuthProvider>
          <BrandingProvider>
            <WebSocketProvider>
              <BrowserRouter>
                <Gate />
              </BrowserRouter>
            </WebSocketProvider>
          </BrandingProvider>
        </AuthProvider>
      </LocaleProvider>
    </ToastProvider>
  </AppThemeProvider>
);

export default App;
