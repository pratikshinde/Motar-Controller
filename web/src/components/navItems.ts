import DashboardIcon from '@mui/icons-material/Dashboard';
import DevicesOtherIcon from '@mui/icons-material/DevicesOther';
import HistoryIcon from '@mui/icons-material/History';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import BusinessIcon from '@mui/icons-material/Business';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import MapIcon from '@mui/icons-material/Map';
import PeopleAltIcon from '@mui/icons-material/PeopleAltOutlined';
import AgricultureIcon from '@mui/icons-material/Agriculture';
import type { SvgIconComponent } from '@mui/icons-material';
import type { RoleTier } from '../types';

export interface NavItemDef {
  path: string;
  labelKey: 'navDashboard' | 'navDevices' | 'navHierarchy' | 'navAudit' | 'navHealth' | 'navAlerts' | 'navManufacturers' | 'navPeople' | 'navFarmers' | 'navMap';
  icon: SvgIconComponent;
}

export interface NavSectionDef {
  title: string;
  items: NavItemDef[];
}

const item = (path: string, labelKey: NavItemDef['labelKey'], icon: SvgIconComponent): NavItemDef => ({ path, labelKey, icon });

const dashboard = item('/dashboard', 'navDashboard', DashboardIcon);
const alerts = item('/alerts', 'navAlerts', NotificationsActiveIcon);
const devices = item('/devices', 'navDevices', DevicesOtherIcon);
const people = item('/people', 'navPeople', PeopleAltIcon);
// A dealer only has farmers under it, so its page is simply Farmers (the same page, without the tabs).
const farmers = item('/people', 'navFarmers', AgricultureIcon);
const manufacturers = item('/manufacturers', 'navManufacturers', BusinessIcon);
const map = item('/map', 'navMap', MapIcon);
const health = item('/health', 'navHealth', MonitorHeartIcon);
const audit = item('/audit', 'navAudit', HistoryIcon);

/** The menu each role sees, kept short on purpose.
 *  The platform owner looks across every manufacturer: its own dashboard, the manufacturers (each opens its own dashboard and team), a map,
 *  and the platform's health and activity. The manufacturer's admin, its distributors and its dealers each get a dashboard, their people (one tab
 *  per level), a map, and the devices and alerts they look after. */
export function menuFor(role: RoleTier | null | undefined): NavSectionDef[] {
  switch (role) {
    case 'superadmin':
      return [
        { title: 'Platform', items: [dashboard, manufacturers, map] },
        { title: 'System', items: [health, audit] }
      ];
    case 'manufacturer':
      return [
        { title: 'Overview', items: [dashboard, people, map] },
        { title: 'Operations', items: [devices, alerts] },
        { title: 'System', items: [audit] }
      ];
    case 'distributor':
      return [
        { title: 'Overview', items: [dashboard, people, map] },
        { title: 'Operations', items: [devices, alerts] }
      ];
    case 'dealer':
      return [
        { title: 'Overview', items: [dashboard, farmers, map] },
        { title: 'Operations', items: [devices, alerts] }
      ];
    case 'support':
      return [{ title: 'Operations', items: [devices, alerts] }];
    default:
      return [];
  }
}

export const menuItemsFor = (role: RoleTier | null | undefined): NavItemDef[] => menuFor(role).flatMap(s => s.items);

/** The menu entry a page belongs to (the manufacturer's own dashboard at /manufacturers/ajanta belongs to Manufacturers). */
export function menuItemForPath(role: RoleTier | null | undefined, pathname: string): NavItemDef | undefined {
  return menuItemsFor(role).find(i => pathname === i.path || pathname.startsWith(i.path + '/'));
}
