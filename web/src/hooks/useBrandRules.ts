import { useEffect, useState } from 'react';
import { fetchMyBrand } from '../api/brands';
import { useAuth } from '../context/AuthContext';

export interface BrandRules {
  /** False until the server has answered (or failed to): the page should not show the full tree before that. */
  loaded: boolean;
  /** `admin_users`: super admin > admin > users (no distributors or dealers). Anything else: the full tree. */
  usersOnly: boolean;
}

const cache = new Map<string, boolean>();

/** Forget what was learned (for tests, and after a brand's rules were changed). */
export const forgetBrandRules = () => cache.clear();

/** The signed-in account's brand rules (brands.features on the server). A failed lookup counts as the full tree, which is what every other brand has. */
export function useBrandRules(): BrandRules {
  const { user } = useAuth();
  const id = user?.id ?? '';
  const [usersOnly, setUsersOnly] = useState<boolean | null>(() => (id && cache.has(id) ? cache.get(id)! : null));

  useEffect(() => {
    if (!id) return;
    if (cache.has(id)) {
      setUsersOnly(cache.get(id)!);
      return;
    }
    let live = true;
    fetchMyBrand()
      .then(res => {
        const v = res.brand?.hierarchy === 'admin_users';
        cache.set(id, v);
        if (live) setUsersOnly(v);
      })
      .catch(() => live && setUsersOnly(false));
    return () => {
      live = false;
    };
  }, [id]);

  return { loaded: usersOnly !== null, usersOnly: usersOnly === true };
}
