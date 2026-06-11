'use client';

import { Suspense, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import SignInModal from '@/components/SignInModal';

/**
 * Inner component — must be separate so Suspense can wrap useSearchParams().
 */
function SignInInner() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') ?? '/';

  // Redirect once signed in
  useEffect(() => {
    if (status === 'authenticated' && session) {
      router.replace(callbackUrl);
    }
  }, [session, status, router, callbackUrl]);

  const handleClose = () => {
    // Closing without signing in → go to home
    router.replace('/');
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-brown-gradient flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brown-gradient flex items-center justify-center">
      <SignInModal open={true} onClose={handleClose} />
    </div>
  );
}

/**
 * /sign-in — NextAuth custom signIn page (pages.signIn in auth.ts).
 * Shows the sign-in modal over a blank dark background.
 * Redirects to callbackUrl (default: /) on successful sign-in.
 *
 * Suspense is required because useSearchParams() causes a CSR bailout
 * during static generation in Next.js 14 App Router.
 */
export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-brown-gradient flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <SignInInner />
    </Suspense>
  );
}
