"use client";

import { useState } from "react";

interface FollowButtonProps {
  userId: string;
  initialFollowing?: boolean;
  className?: string;
}

/**
 * Stateless Follow/Following toggle.
 * CEO-2 will wire this to the API — for now it's client-side only.
 */
export default function FollowButton({
  userId: _userId,
  initialFollowing = false,
  className = "",
}: FollowButtonProps) {
  const [following, setFollowing] = useState(initialFollowing);

  return (
    <button
      onClick={() => setFollowing((f) => !f)}
      data-following={following}
      className={`text-xs font-semibold px-3 py-1 rounded-full border transition-colors flex-shrink-0
        ${
          following
            ? "bg-indigo-600 border-indigo-600 text-white"
            : "border-indigo-500 text-indigo-400 hover:bg-indigo-500 hover:text-white"
        } ${className}`}
    >
      {following ? "Following" : "+ Follow"}
    </button>
  );
}
