import { describe, expect, it } from 'vitest';
import { menuFor, menuItemForPath, menuItemsFor } from '../navItems';
import { ASSIGNABLE_ROLES } from '../../api/users';
import type { RoleTier } from '../../types';

/** The paths this role sees in the menu, in order. */
const menu = (role: RoleTier) => menuItemsFor(role).map(i => i.path);
const labels = (role: RoleTier) => menuItemsFor(role).map(i => i.labelKey);

describe('the menu is short, and each role sees only its own pages', () => {
  it('the platform owner: dashboard, manufacturers, map, then platform health and the activity log', () => {
    expect(menu('superadmin')).toEqual(['/dashboard', '/manufacturers', '/map', '/health', '/audit']);
  });

  it('the admin: dashboard, people, map, then devices and alerts, and the activity log', () => {
    expect(menu('manufacturer')).toEqual(['/dashboard', '/people', '/map', '/devices', '/alerts', '/audit']);
  });

  it('a distributor has five pages, without the activity log', () => {
    expect(menu('distributor')).toEqual(['/dashboard', '/people', '/map', '/devices', '/alerts']);
    expect(labels('distributor')[1]).toBe('navPeople');
  });

  it('a dealer has Farmers where the others have People, because farmers are all it has under it', () => {
    expect(menu('dealer')).toEqual(['/dashboard', '/people', '/map', '/devices', '/alerts']);
    expect(labels('dealer')[1]).toBe('navFarmers');
  });

  it('a farmer has none: farmers use the app', () => {
    expect(menu('customer')).toEqual([]);
  });

  it('the platform owner does not get the admin’s working pages', () => {
    for (const path of ['/alerts', '/devices', '/people', '/hierarchy']) expect(menu('superadmin')).not.toContain(path);
  });

  it('no page appears twice in one menu, and the old duplicates are gone', () => {
    for (const role of ['superadmin', 'manufacturer', 'distributor', 'dealer', 'support'] as RoleTier[]) {
      const paths = menu(role);
      expect(new Set(paths).size).toBe(paths.length);
      for (const gone of ['/fleet', '/faults', '/farmers', '/hierarchy', '/factory-station', '/config-templates', '/service-reports', '/factory', '/support']) {
        expect(paths).not.toContain(gone);
      }
    }
  });

  it('every section has a title and at least one page', () => {
    for (const role of ['superadmin', 'manufacturer', 'distributor', 'dealer'] as RoleTier[]) {
      for (const section of menuFor(role)) {
        expect(section.title).toBeTruthy();
        expect(section.items.length).toBeGreaterThan(0);
      }
    }
  });

  it('one admin’s own dashboard belongs to Manufacturers in the menu', () => {
    expect(menuItemForPath('superadmin', '/manufacturers/ajanta')?.path).toBe('/manufacturers');
    expect(menuItemForPath('superadmin', '/manufacturers')?.path).toBe('/manufacturers');
    expect(menuItemForPath('superadmin', '/nowhere')).toBeUndefined();
  });
});

describe('who may create whom (mirrors the server)', () => {
  it('follows the hierarchy: admin > distributor > dealer > farmer, and the platform owner makes admins on its own page', () => {
    expect(ASSIGNABLE_ROLES.superadmin).toEqual([]);
    expect(ASSIGNABLE_ROLES.manufacturer).toEqual(['distributor', 'dealer', 'customer']);
    expect(ASSIGNABLE_ROLES.distributor).toEqual(['dealer', 'customer']);
    expect(ASSIGNABLE_ROLES.dealer).toEqual(['customer']);
    expect(ASSIGNABLE_ROLES.customer).toEqual([]);
  });
});
