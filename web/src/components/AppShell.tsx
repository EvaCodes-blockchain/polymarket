'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import LeftSidebar from './LeftSidebar';
import RightSidebar from './RightSidebar';
import MobileHeader from './MobileHeader';
import SignInModal from './SignInModal';
import WalletConnectModal from './WalletConnectModal';

interface AppShellProps {
  children: React.ReactNode;
}

/**
 * Three-column layout matching prototype FR-NAV-1:
 *   - Left sidebar (xl: fixed col, mobile: hidden / off-canvas TBD)
 *   - Center column (main content)
 *   - Right sidebar (xl: visible, smaller screens: hidden)
 *
 * Hosts both SignInModal (CEO-1) and WalletConnectModal (CEO-3).
 * WalletConnectModal is triggered by:
 *   - SignInModal's MetaMask button (fires `justify:connectWallet` event)
 *   - Direct `justify:connectWallet` dispatches from any component
 */
export default function AppShell({ children }: AppShellProps) {
  const [signInOpen, setSignInOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const { data: session } = useSession();

  // Listen for the custom event fired by SignInModal's MetaMask button
  // and by FollowButton's unauthenticated click.
  useEffect(() => {
    const handleConnectWallet = () => setWalletOpen(true);
    const handleOpenSignIn = () => setSignInOpen(true);

    window.addEventListener('justify:connectWallet', handleConnectWallet);
    window.addEventListener('justify:openSignIn', handleOpenSignIn);
    return () => {
      window.removeEventListener('justify:connectWallet', handleConnectWallet);
      window.removeEventListener('justify:openSignIn', handleOpenSignIn);
    };
  }, []);

  return (
    <>
      {/* Mobile top bar */}
      <MobileHeader
        onSignInClick={session ? () => undefined : () => setSignInOpen(true)}
        session={session}
      />

      <div className="py-4">
        <div className="container mx-auto px-0">
          <div className="grid grid-cols-12 relative gap-0">
            {/* Left sidebar */}
            <LeftSidebar
              onSignInClick={session ? () => undefined : () => setSignInOpen(true)}
              session={session}
            />

            {/* Center */}
            <main className="col-span-12 xl:col-span-6 border-l border-r border-white/10 min-h-screen">
              {children}
            </main>

            {/* Right sidebar */}
            <RightSidebar />
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="py-3 bg-glass border-t border-white/10">
        <div className="container mx-auto px-4 flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs text-gray-400">
            ©2025 <b className="text-indigo-400">Justify</b>. All rights reserved
          </span>
          <div className="flex items-center gap-2">
            {['facebook', 'twitter', 'linkedin', 'youtube', 'instagram'].map((s) => (
              <a
                key={s}
                href="#"
                className="text-gray-400 hover:text-white transition-colors text-xs"
              >
                {s[0]?.toUpperCase()}
              </a>
            ))}
          </div>
        </div>
      </footer>

      {/* Sign-in modal (CEO-1) */}
      {!session && (
        <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
      )}

      {/* Wallet connect modal (CEO-3) */}
      <WalletConnectModal
        open={walletOpen}
        onClose={() => setWalletOpen(false)}
      />
    </>
  );
}
