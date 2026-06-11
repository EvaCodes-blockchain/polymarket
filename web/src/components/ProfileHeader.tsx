'use client';

import { useState } from 'react';
import Image from 'next/image';
import FollowButton from './FollowButton';

interface ProfileData {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  createdAt: string;
}

interface ProfileHeaderProps {
  profile: ProfileData;
  followerCount: number;
  followingCount: number;
  viewerFollows: boolean;
}

/**
 * Profile header card matching prototype profile.html:
 * - Avatar, display name, handle, bio, join date
 * - Follower / Following counts (live-updated after follow toggle)
 * - Follow / Following toggle button (wired to /api/social/follow)
 */
export default function ProfileHeader({
  profile,
  followerCount: initialFollowerCount,
  followingCount,
  viewerFollows,
}: ProfileHeaderProps) {
  const [followerCount, setFollowerCount] = useState(initialFollowerCount);

  const handleFollowToggle = (nowFollowing: boolean) => {
    setFollowerCount((c) => c + (nowFollowing ? 1 : -1));
  };

  // Derive display handle from email (strip @domain) or name
  const handle =
    profile.email?.split('@')[0] ??
    profile.name?.toLowerCase().replace(/\s+/g, '') ??
    profile.id.slice(0, 8);

  const displayName = profile.name ?? handle;

  // Format join date
  const joinedDate = new Date(profile.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });

  return (
    <div className="bg-glass rounded-2xl shadow-sm p-4 mb-1">
      {/* Top row: avatar + name + follow button */}
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div className="flex-shrink-0">
          {profile.image ? (
            <Image
              src={profile.image}
              alt={displayName}
              width={64}
              height={64}
              className="rounded-full object-cover w-16 h-16"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-2xl">
              {displayName[0]?.toUpperCase()}
            </div>
          )}
        </div>

        {/* Name + handle */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h1 className="text-white font-bold text-base truncate">{displayName}</h1>
            <span className="material-icons text-indigo-400 text-base leading-none">done</span>
          </div>
          <p className="text-gray-400 text-sm">@{handle}</p>
        </div>

        {/* Follow button */}
        <div className="flex-shrink-0">
          <FollowButton
            userId={profile.id}
            initialFollowing={viewerFollows}
            onToggle={handleFollowToggle}
          />
        </div>
      </div>

      {/* Bio */}
      <div className="mt-3">
        <p className="text-gray-300 text-sm leading-relaxed">
          Founder of Justify — the Social Prediction Platform on Base
          {'\n'}Building the future of onchain opinion markets.
          {'\n'}Web3 believer. Product thinker. Social Trading
        </p>
      </div>

      {/* Link + join date */}
      <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
        <div className="flex items-center gap-1">
          <span className="material-icons text-gray-400 rotate-45" style={{ fontSize: 14 }}>
            link
          </span>
          <a href="#" className="text-indigo-400 hover:underline">
            justify.market/{handle}
          </a>
        </div>
        <div className="flex items-center gap-1">
          <span className="material-icons text-gray-400" style={{ fontSize: 14 }}>
            calendar_today
          </span>
          <span>Joined {joinedDate}</span>
        </div>
      </div>

      {/* Follower / Following counts */}
      <div className="flex items-center gap-8 mt-3">
        {/* Followers */}
        <div>
          <p className="text-white text-sm font-semibold">
            {followerCount >= 1000
              ? `${(followerCount / 1000).toFixed(0)}k`
              : followerCount}{' '}
            <span className="text-gray-400 font-normal">Followers</span>
          </p>
        </div>

        {/* Following */}
        <div>
          <p className="text-white text-sm font-semibold">
            {followingCount}{' '}
            <span className="text-gray-400 font-normal">Following</span>
          </p>
        </div>
      </div>
    </div>
  );
}
