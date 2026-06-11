'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { wagmiConfig } from '@/lib/client/wagmi';
import { useState } from 'react';

/**
 * Client-only providers for wagmi + react-query.
 * Wrapped inside the existing SessionProvider (Providers.tsx).
 */
export default function WagmiProviders({ children }: { children: React.ReactNode }) {
  // Stable QueryClient — must be created in state to avoid SSR mismatch
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
