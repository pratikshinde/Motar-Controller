import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppThemeProvider } from './theme/ColorModeContext';
import { ToastProvider } from './context/ToastContext';
import { LocaleProvider } from './context/LocaleContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { useViewing } from './api/viewing';
import { BrandingProvider } from './context/BrandingContext';
import { WebSocketProvider } from './context/WebSocketContext';
import { AppShell } from './components/AppShell';
import { LoginView } from './views/LoginView';
import { HomeView } from './views/home/HomeView';
import { DeviceDetailView } from './views/DeviceDetailView';
import { AuditLogView } from './views/AuditLogView';
import { FactoryConsoleView } from './views/FactoryConsoleView';
import { HierarchyView } from './views/HierarchyView';
import { SystemHealthView } from './views/SystemHealthView';
import { SupportConsoleView } from './views/SupportConsoleView';
import { InviteRedeemView } from './views/InviteRedeemView';
import { ClaimView } from './views/ClaimView';
import { RegisterView } from './views/RegisterView';
import { ConfigTemplatesView } from './views/ConfigTemplatesView';
import { ServiceReportsView } from './views/ServiceReportsView';
import { ManufacturersView } from './views/ManufacturersView';
import { DevicesHub } from './views/hubs';
import { AlertsView } from './views/AlertsView';
import { PeopleView } from './views/people/PeopleView';
import { PersonDashboardView } from './views/people/PersonDashboardView';
import { ManagerDashboardView } from './views/people/ManagerDashboardView';
import { PortalMapView } from './views/people/PortalMapView';
import { PlatformDashboardView } from './views/platform/PlatformDashboardView';
import { ManufacturerDashboardView } from './views/platform/ManufacturerDashboardView';
import { PlatformMapView } from './views/platform/PlatformMapView';
import { LightScope } from './theme/LightScope';

// The public pages are drawn on a fixed light palette, so they always render with the light theme.
const publicPage = (page: React.ReactElement) => <LightScope>{page}</LightScope>;

// Where a signed-in person lands: the platform owner on the list of manufacturers, everyone else on their own pumps.
const homePath = (role: string | null) => (role === 'support' ? '/devices' : '/dashboard');

const AuthenticatedApp: React.FC = () => {
  const { role } = useAuth();
  const viewing = useViewing();
  return (
  <Routes>
    <Route element={<AppShell />}>
      <Route path="/manufacturers" element={role === 'superadmin' ? <ManufacturersView /> : <Navigate to="/dashboard" replace />} />
      <Route path="/manufacturers/:key" element={role === 'superadmin' ? <ManufacturerDashboardView /> : <Navigate to="/dashboard" replace />} />
      <Route path="/map" element={role === 'superadmin' ? <PlatformMapView /> : <PortalMapView />} />
      <Route path="/people" element={<PeopleView />} />
      <Route path="/people/:id" element={<PersonDashboardView />} />
      <Route path="/farmers" element={<Navigate to="/people?tab=customer" replace />} />
      <Route path="/dashboard" element={role === 'superadmin' ? <PlatformDashboardView /> : role === 'support' ? <Navigate to="/devices" replace /> : <ManagerDashboardView />} />
      <Route path="/telemetry" element={<Navigate to="/devices?tab=live" replace />} />
      <Route path="/fleet" element={<Navigate to="/dashboard" replace />} />
      <Route path="/devices" element={<DevicesHub />} />
      <Route path="/devices/:id" element={<DeviceDetailView />} />
      <Route path="/hierarchy" element={role === 'manufacturer' || role === 'distributor' || (role === 'superadmin' && viewing) ? <HierarchyView /> : <Navigate to="/dashboard" replace />} />
      <Route path="/faults" element={<Navigate to="/alerts" replace />} />
      <Route path="/config-templates" element={<ConfigTemplatesView />} />
      <Route path="/service-reports" element={<ServiceReportsView />} />
      <Route path="/alerts" element={<AlertsView />} />
      <Route path="/audit" element={<AuditLogView />} />
      <Route path="/factory" element={<FactoryConsoleView />} />
      <Route path="/factory-station" element={<Navigate to="/devices?tab=factory" replace />} />
      <Route path="/health" element={<SystemHealthView />} />
      <Route path="/support" element={<SupportConsoleView />} />
      <Route path="*" element={<Navigate to={homePath(role)} replace />} />
    </Route>
  </Routes>
  );
};

// /invite/:token (FR-WEB-035) must be reachable with no session at all —
// that's the whole point of a self-registration link — so it's matched
// before the auth gate rather than nested inside AuthenticatedApp.
const Gate: React.FC = () => {
  const { isAuthenticated, role } = useAuth();
  return (
    <Routes>
      <Route path="/" element={isAuthenticated ? <Navigate to={homePath(role)} replace /> : publicPage(<HomeView />)} />

      {/* Authentication & Onboarding Portal */}
      <Route path="/login" element={isAuthenticated ? <Navigate to={homePath(role)} replace /> : publicPage(<LoginView defaultTab="login" />)} />
      <Route path="/login/admin" element={isAuthenticated ? <Navigate to={homePath(role)} replace /> : publicPage(<LoginView variant="admin" />)} />
      <Route path="/login/distributor" element={isAuthenticated ? <Navigate to={homePath(role)} replace /> : publicPage(<LoginView variant="distributor" />)} />
      <Route path="/login/dealer" element={isAuthenticated ? <Navigate to={homePath(role)} replace /> : publicPage(<LoginView variant="dealer" />)} />
      <Route path="/owner" element={isAuthenticated ? <Navigate to={homePath(role)} replace /> : publicPage(<LoginView variant="owner" />)} />
      <Route path="/auth/login" element={isAuthenticated ? <Navigate to={homePath(role)} replace /> : publicPage(<LoginView defaultTab="login" />)} />
      <Route path="/register" element={<Navigate to="/login" replace />} />
      <Route path="/auth/register" element={<Navigate to="/login" replace />} />
      <Route path="/auth/register/*" element={<Navigate to="/login" replace />} />
      <Route path="/auth/verify-otp" element={isAuthenticated ? <Navigate to={homePath(role)} replace /> : publicPage(<LoginView defaultTab="login" />)} />
      <Route path="/auth/mfa" element={isAuthenticated ? <Navigate to={homePath(role)} replace /> : publicPage(<LoginView defaultTab="login" />)} />

      {/* Invite Redemption Token */}
      <Route path="/invite/:token" element={<InviteRedeemView />} />
      <Route path="/claim/:token" element={<ClaimView />} />
      <Route path="/register/:token" element={<RegisterView />} />

      {/* Protected Dashboard */}
      <Route path="/*" element={isAuthenticated ? <AuthenticatedApp /> : <Navigate to="/" replace />} />
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
