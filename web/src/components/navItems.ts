import ElectricBoltIcon from '@mui/icons-material/ElectricBolt';
import DashboardIcon from '@mui/icons-material/Dashboard';
import DevicesOtherIcon from '@mui/icons-material/DevicesOther';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import MapIcon from '@mui/icons-material/Map';
import HistoryIcon from '@mui/icons-material/History';
import PrecisionManufacturingIcon from '@mui/icons-material/PrecisionManufacturing';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import TuneIcon from '@mui/icons-material/Tune';
import AssignmentIcon from '@mui/icons-material/Assignment';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import type { SvgIconComponent } from '@mui/icons-material';
import type { RoleTier } from '../types';

export interface NavItemDef {
  path: string;
  labelKey:
    | 'navTelemetry' | 'navDevices' | 'navHierarchy' | 'navFaultLogs' | 'navMap' | 'navAudit'
    | 'navFleet' | 'navFactory' | 'navHealth' | 'navSupport' | 'navConfigTemplates' | 'navServiceReports' | 'navAlerts';
  icon: SvgIconComponent;
  /** Omit to show for every role; the backing endpoint itself 403s outside this set. */
  roles?: RoleTier[];
}

const PRIVILEGED: RoleTier[] = ['superadmin', 'manufacturer', 'distributor', 'dealer'];

export const navItems: NavItemDef[] = [
  { path: '/dashboard', labelKey: 'navTelemetry', icon: ElectricBoltIcon },
  { path: '/fleet', labelKey: 'navFleet', icon: DashboardIcon, roles: PRIVILEGED },
  { path: '/alerts', labelKey: 'navAlerts', icon: NotificationsActiveIcon },
  { path: '/devices', labelKey: 'navDevices', icon: DevicesOtherIcon },
  { path: '/hierarchy', labelKey: 'navHierarchy', icon: AccountTreeIcon, roles: PRIVILEGED },
  { path: '/faults', labelKey: 'navFaultLogs', icon: ReportProblemIcon },
  { path: '/map', labelKey: 'navMap', icon: MapIcon },
  { path: '/config-templates', labelKey: 'navConfigTemplates', icon: TuneIcon, roles: PRIVILEGED },
  { path: '/service-reports', labelKey: 'navServiceReports', icon: AssignmentIcon, roles: PRIVILEGED },
  { path: '/audit', labelKey: 'navAudit', icon: HistoryIcon, roles: PRIVILEGED },
  { path: '/factory', labelKey: 'navFactory', icon: PrecisionManufacturingIcon, roles: ['superadmin'] },
  { path: '/health', labelKey: 'navHealth', icon: MonitorHeartIcon, roles: ['superadmin'] },
  { path: '/support', labelKey: 'navSupport', icon: SupportAgentIcon, roles: ['superadmin'] }
];
