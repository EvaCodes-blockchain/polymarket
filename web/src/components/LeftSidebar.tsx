"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Feed", icon: "house" },
  { href: "/markets", label: "Markets", icon: "candlestick_chart" },
  { href: "/portfolio", label: "Portfolio", icon: "cases" },
  { href: "/notifications", label: "Notifications", icon: "notification_add" },
  { href: "/profile", label: "My Profile", icon: "account_circle" },
  { href: "/create", label: "Create Market", icon: "local_fire_department" },
] as const;

const BOTTOM_ITEMS = [
  { href: "/settings", label: "Settings", icon: "settings" },
  { href: "/help", label: "Help Center", icon: "help" },
] as const;

interface LeftSidebarProps {
  onSignInClick?: () => void;
}

export default function LeftSidebar({ onSignInClick }: LeftSidebarProps) {
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
              letterSpacing: "0.02em",
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
                          ? "text-white bg-white/10"
                          : "text-gray-400 hover:text-white hover:bg-white/5"
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
                          ? "text-white bg-white/10"
                          : "text-gray-400 hover:text-white hover:bg-white/5"
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

        {/* Sign In button */}
        <div className="mt-4">
          <button
            onClick={onSignInClick}
            className="w-full rounded-xl py-3 font-bold uppercase text-sm
                       bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
          >
            Sign In +
          </button>
        </div>
      </div>
    </aside>
  );
}
