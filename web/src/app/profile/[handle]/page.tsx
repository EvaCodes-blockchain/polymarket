import { notFound } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';
import ProfileHeader from '@/components/ProfileHeader';
import AppShell from '@/components/AppShell';

interface ProfileApiResponse {
  profile: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
    createdAt: string;
  };
  followerCount: number;
  followingCount: number;
  viewerFollows: boolean;
}

interface ProfilePageProps {
  params: { handle: string };
}

/**
 * /profile/[handle] — public profile page.
 * handle = userId, email, or name (resolved by GET /api/profile/[handle]).
 * Fetches server-side; viewer's session is used to determine viewerFollows.
 *
 * Note: AppShell is imported from the scaffold branch — available after
 * feat/mvp/web-scaffold merges into mvp.
 */
export default async function ProfilePage({ params }: ProfilePageProps) {
  const session = await getServerSession(authOptions);

  const baseUrl =
    process.env.NEXTAUTH_URL ?? 'http://localhost:3000';

  const res = await fetch(
    `${baseUrl}/api/profile/${encodeURIComponent(params.handle)}`,
    {
      // Pass session cookie so viewerFollows is accurate
      headers: session
        ? { Cookie: `next-auth.session-token=${session}` }
        : {},
      cache: 'no-store',
    },
  );

  if (res.status === 404) notFound();

  if (!res.ok) {
    throw new Error(`Failed to load profile: ${res.status}`);
  }

  const data = (await res.json()) as ProfileApiResponse;

  return (
    <AppShell>
      <div className="border-b border-white/10">
        {/* Back header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
          <a
            href="/"
            className="material-icons text-white no-underline"
            aria-label="Back"
          >
            arrow_back
          </a>
          <p className="text-white font-bold text-sm">
            {data.profile.name ?? data.profile.email}
          </p>
          <a
            href="#"
            className="ml-auto material-icons text-gray-400 hover:text-white no-underline"
            aria-label="Share"
          >
            share
          </a>
        </div>

        {/* Profile header card */}
        <div className="px-3 py-4">
          <ProfileHeader
            profile={data.profile}
            followerCount={data.followerCount}
            followingCount={data.followingCount}
            viewerFollows={data.viewerFollows}
          />
        </div>

        {/* Tab nav — non-essential tabs static per task spec */}
        <nav className="flex border-b border-white/10">
          {['Posts', 'Liked', 'Replies', 'Mentions'].map((tab, i) => (
            <button
              key={tab}
              className={`flex-1 py-3 text-sm font-medium transition-colors
                ${i === 0
                  ? 'text-white border-b-2 border-indigo-500'
                  : 'text-gray-400 hover:text-white'
                }`}
            >
              {tab}
            </button>
          ))}
        </nav>

        {/* Static post feed — non-essential; replaced in a later task */}
        <div className="py-8 text-center text-gray-500 text-sm">
          No posts yet.
        </div>
      </div>
    </AppShell>
  );
}

export async function generateMetadata({ params }: ProfilePageProps) {
  return {
    title: `@${params.handle} — Justify`,
  };
}
