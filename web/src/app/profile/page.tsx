import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';

/**
 * /profile — redirects to the current user's profile page.
 * If not signed in, redirects to the founder's profile (CEO-2 demo target).
 */
export default async function ProfileIndexPage() {
  const session = await getServerSession(authOptions);

  if (session?.user?.email) {
    redirect(`/profile/${encodeURIComponent(session.user.email)}`);
  }

  // Fallback: show the founder's seeded profile
  redirect('/profile/founder@justify.local');
}
