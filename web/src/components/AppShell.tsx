'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import LeftSidebar from './LeftSidebar';
import RightSidebar from './RightSidebar';
import MobileHeader from './MobileHeader';
import SignInModal from './SignInModal';

interface AppShellProps {
  children: React.ReactNode;
}

/**
 * Three-column layout matching prototype FR-NAV-1:
 *   - Left sidebar (xl: fixed col, mobile: hidden / off-canvas TBD)
 *   - Center column (main content)
 *   - Right sidebar (xl: visible, smaller screens: hidden)
 */
export default function AppShell({ children }: AppShellProps) {
  const [signInOpen, setSignInOpen] = useState(false);
  const { data: session } = useSession();

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
            {/* Left sidebar — col-span-3 on xl */}
            <LeftSidebar
              onSignInClick={session ? () => undefined : () => setSignInOpen(true)}
              session={session}
            />

            {/* Center — 6 cols on xl, full on smaller */}
            <main className="col-span-12 xl:col-span-6 border-l border-r border-white/10 min-h-screen">
              {children}
            </main>

            {/* Right sidebar — col-span-3 on xl */}
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

      {/* Sign-in modal */}
      {!session && (
        <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
      )}
    </>
  );
}
