"use client";

import Link from "next/link";
import Image from "next/image";

interface MobileHeaderProps {
  onMenuClick?: () => void;
  onSignInClick?: () => void;
}

export default function MobileHeader({
  onMenuClick,
  onSignInClick: _onSignInClick,
}: MobileHeaderProps) {
  return (
    <div className="xl:hidden flex items-center px-4 pt-3 pb-2 shadow-sm bg-brown-gradient sticky top-0 z-40">
      <Link href="/" className="no-underline">
        <Image src="/img/logo.png" alt="Justify" width={32} height={32} />
      </Link>
      <button
        onClick={onMenuClick}
        className="ml-auto bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl p-1 transition-colors"
        aria-label="Open menu"
      >
        <span className="material-icons">menu</span>
      </button>
    </div>
  );
}
