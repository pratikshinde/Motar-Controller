import { useEffect, useState } from 'react';
import { fetchMyBrand } from '../api/brands';
import { useAuth } from '../context/AuthContext';

/** What the platform is called for the platform owner and before anyone has signed in. */
export const PLATFORM_NAME = 'Pump Controller';

const cache = new Map<string, string>();

/** The name on the website for whoever is signed in: an admin, its distributors and its dealers see their own manufacturer's name (Ajanta's people
 *  see "Ajanta Pump Controller", Swati's see Swati's), the platform owner sees "Pump Controller". */
export function useBrandName(): string {
  const { user } = useAuth();
  const id = user?.id ?? '';
  const [name, setName] = useState<string>(() => (id && cache.get(id)) || PLATFORM_NAME);

  useEffect(() => {
    if (!id) {
      setName(PLATFORM_NAME);
      return;
    }
    const known = cache.get(id);
    if (known) {
      setName(known);
      return;
    }
    let live = true;
    fetchMyBrand()
      .then(res => {
        const n = res.brand?.name || PLATFORM_NAME;
        cache.set(id, n);
        if (live) setName(n);
      })
      .catch(() => live && setName(PLATFORM_NAME));
    return () => {
      live = false;
    };
  }, [id]);

  return name;
}
