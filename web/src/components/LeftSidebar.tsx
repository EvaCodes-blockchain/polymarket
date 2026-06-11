'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import type { Session } from 'next-auth';

const NAV_ITEMS = [
  { href: '/', label: 'Feed', icon: 'house' },
  { href: '/markets', label: 'Markets', icon: 'candlestick_chart' },
  { href: '/portfolio', label: 'Portfolio', icon: 'cases' },
  { href: '/notifications', label: 'Notifications', icon: 'notification_add' },
  { href: '/profile', label: 'My Profile', icon: 'account_circle' },
  { href: '/create', label: 'Create Market', icon: 'local_fire_department' },
] as const;

const BOTTOM_ITEMS = [
  { href: '/settings', label: 'Settings', icon: 'settings' },
  { href: '/help', label: 'Help Center', icon: 'help' },
] as const;

interface LeftSidebarProps {
  onSignInClick?: (() => void) | undefined;
  session?: Session | null | undefined;
}

export default function LeftSidebar({ onSignInClick, session }: LeftSidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="col-span-3 hidden xl:block">
      <div className="fix-sidebar py-3 pr-3 sticky top-0 h-screen flex flex-col">
        {/* Logo */}
        <div className="pb-8 mb-4">
          <Link
            href="/"
            className="no-underline text-white"
            style={{
              fontFamily: "'ClashDisplay', sans-serif",
              fontWeight: 500,
              fontSize: 30,
              letterSpacing: '0.02em',
            }}
          >
            JUSTIFY
          </Link>
        </div>

        {/* Main nav */}
        <nav className="flex-1">
          <ul className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-sm font-medium
                      ${
                        active
                          ? 'text-white bg-white/10'
                          : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                  >
                    <span className="material-icons md-20">{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>

          {/* Divider */}
          <div className="my-4 border-t border-white/10" />

          <ul className="space-y-1">
            {BOTTOM_ITEMS.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-sm font-medium
                      ${
                        active
                          ? 'text-white bg-white/10'
                          : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                  >
                    <span className="material-icons md-20">{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Auth section */}
        <div className="mt-4">
          {session?.user ? (
            /* Signed-in: show avatar + name + sign-out */
            <div className="flex items-center gap-3 px-2 py-2 rounded-xl bg-white/5">
              {session.user.image ? (
                <Image
                  src={session.user.image}
                  alt={session.user.name ?? 'User'}
                  width={36}
                  height={36}
                  className="rounded-full object-cover"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                  {(session.user.name ?? session.user.email ?? '?')[0]?.toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs font-semibold truncate">
                  {session.user.name ?? session.user.email}
                </p>
                {session.user.name && (
                  <p className="text-gray-400 text-xs truncate">{session.user.email}</p>
                )}
              </div>
              <button
                onClick={() => signOut({ callbackUrl: '/' })}
                title="Sign out"
                className="text-gray-400 hover:text-white material-icons md-18 transition-colors flex-shrink-0"
              >
                logout
              </button>
            </div>
          ) : (
            /* Not signed in: Sign In button */
            <button
              onClick={onSignInClick}
              className="w-full rounded-xl py-3 font-bold uppercase text-sm
                         bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
            >
              Sign In +
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
