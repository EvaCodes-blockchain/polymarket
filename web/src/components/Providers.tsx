'use client';

import { SessionProvider } from 'next-auth/react';
import WagmiProviders from './WagmiProviders';

/**
 * Combined providers wrapper:
 * - SessionProvider (NextAuth v4) for session/auth state
 * - WagmiProviders (wagmi v2 + react-query) for wallet state
 *
 * WagmiProviders is nested inside SessionProvider so wagmi hooks
 * can access session if needed.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <WagmiProviders>
        {children}
      </WagmiProviders>
    </SessionProvider>
  );
}
