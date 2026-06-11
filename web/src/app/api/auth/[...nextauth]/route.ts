// NextAuth.js catch-all route handler (Next.js 14 App Router)
// Handles: GET/POST /api/auth/[...nextauth]
//   - /api/auth/signin
//   - /api/auth/signout
//   - /api/auth/session
//   - /api/auth/csrf
//   - /api/auth/providers
//   - /api/auth/callback/:provider

import NextAuth from 'next-auth';

import { authOptions } from '@/lib/server/auth';

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
