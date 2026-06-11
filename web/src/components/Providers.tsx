'use client';

import { SessionProvider } from 'next-auth/react';

interface ProvidersProps {
  children: React.ReactNode;
}

/**
 * Client-side providers wrapper.
 * Lives outside the server layout so SessionProvider (client) can be used
 * without making the whole layout a client component.
 */
export default function Providers({ children }: ProvidersProps) {
  return <SessionProvider>{children}</SessionProvider>;
}
