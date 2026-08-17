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

const AuthenticatedApp: React.FC = () => (
  <Routes>
    <Route element={<AppShell />}>
      <Route path="/" element={<TelemetryView />} />
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
      <Route path="*" element={<Navigate to="/" replace />} />
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
      <Route path="/invite/:token" element={<InviteRedeemView />} />
      <Route path="/*" element={isAuthenticated ? <AuthenticatedApp /> : <LoginView />} />
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
