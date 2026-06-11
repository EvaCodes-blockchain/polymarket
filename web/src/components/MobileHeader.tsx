'use client';

import Link from 'next/link';
import Image from 'next/image';
import { signOut } from 'next-auth/react';
import type { Session } from 'next-auth';

interface MobileHeaderProps {
  onMenuClick?: (() => void) | undefined;
  onSignInClick?: (() => void) | undefined;
  session?: Session | null | undefined;
}

export default function MobileHeader({
  onMenuClick,
  onSignInClick,
  session,
}: MobileHeaderProps) {
  return (
    <div className="xl:hidden flex items-center px-4 pt-3 pb-2 shadow-sm bg-brown-gradient sticky top-0 z-40 gap-3">
      <Link href="/" className="no-underline">
        <Image src="/img/logo.png" alt="Justify" width={32} height={32} />
      </Link>

      {session?.user ? (
        <div className="ml-auto flex items-center gap-2">
          {session.user.image ? (
            <Image
              src={session.user.image}
              alt={session.user.name ?? 'User'}
              width={32}
              height={32}
              className="rounded-full object-cover"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold">
              {(session.user.name ?? session.user.email ?? '?')[0]?.toUpperCase()}
            </div>
          )}
          <button
            onClick={() => signOut({ callbackUrl: '/' })}
            className="text-gray-400 hover:text-white material-icons md-18 transition-colors"
            aria-label="Sign out"
          >
            logout
          </button>
        </div>
      ) : (
        <button
          onClick={onSignInClick}
          className="ml-auto text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg transition-colors"
        >
          Sign In
        </button>
      )}

      <button
        onClick={onMenuClick}
        className="bg-white/10 hover:bg-white/20 text-white rounded-xl p-1 transition-colors"
        aria-label="Open menu"
      >
        <span className="material-icons">menu</span>
      </button>
    </div>
  );
}
