import { useEffect } from 'react';
import { useRouter } from 'expo-router';

/** An unknown link (for example an old deep link) just goes to the start screen. */
export default function NotFound() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/');
  }, [router]);
  return null;
}
