'use client';

import { useState, useTransition } from 'react';
import { useSession } from 'next-auth/react';

interface FollowButtonProps {
  /** DB userId of the profile being viewed */
  userId: string;
  /** Whether the session user already follows this profile */
  initialFollowing: boolean;
  /** Called after a successful follow/unfollow so the parent can update counts */
  onToggle?: (nowFollowing: boolean) => void;
}

/**
 * Follow / Following toggle button.
 * - Calls POST /api/social/follow to follow, DELETE /api/social/follow to unfollow.
 * - Optimistic UI: switches label immediately, rolls back on error.
 * - Shows disabled state when session is loading or request is in-flight.
 */
export default function FollowButton({
  userId,
  initialFollowing,
  onToggle,
}: FollowButtonProps) {
  const { data: session } = useSession();
  const [following, setFollowing] = useState(initialFollowing);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Don't show the button on your own profile
  if (session?.user?.id === userId) return null;

  const handleClick = () => {
    if (!session) {
      // Not signed in — dispatch the same event SignInModal listens to
      window.dispatchEvent(new CustomEvent('justify:openSignIn'));
      return;
    }

    const nextFollowing = !following;
    // Optimistic update
    setFollowing(nextFollowing);
    setError(null);

    startTransition(async () => {
      try {
        const res = await fetch('/api/social/follow', {
          method: nextFollowing ? 'POST' : 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ followeeId: userId }),
        });

        if (!res.ok) {
          const body = (await res.json()) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }

        onToggle?.(nextFollowing);
      } catch (err) {
        // Roll back optimistic update
        setFollowing(!nextFollowing);
        setError(err instanceof Error ? err.message : 'Failed to update follow');
      }
    });
  };

  const disabled = isPending;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={disabled}
        className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-colors border
          ${
            following
              ? 'bg-transparent border-white/30 text-white hover:border-red-400 hover:text-red-400'
              : 'bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-700 hover:border-indigo-700'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        aria-pressed={following}
        aria-label={following ? 'Unfollow' : 'Follow'}
      >
        {following ? 'Following' : '+ Follow'}
      </button>
      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}
