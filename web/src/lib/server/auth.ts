// NextAuth.js configuration — integration contract.
// Import this wherever you need the session (e.g. API routes, server components).
//
// SESSION SHAPE CONTRACT (frozen — announce before changing):
//   session.user.id:    string   (cuid — User.id from DB)
//   session.user.email: string | null
//   session.user.name:  string | null
//   session.user.image: string | null
//
// AUTH ROUTES:
//   GET/POST /api/auth/[...nextauth]  — NextAuth handler (sign in, sign out, session, CSRF)
//   POST     /api/auth/register       — create account with email + password (credentials only)
//
// PROVIDERS:
//   CredentialsProvider — email + bcrypt hashed password (always enabled for local MVP)
//   GoogleProvider      — enabled when GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET are set

import { PrismaAdapter } from '@auth/prisma-adapter';
import bcrypt from 'bcryptjs';
import type { NextAuthOptions, Session, User } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';

import { db } from '@/lib/server/db';

// ---------------------------------------------------------------------------
// Type augmentation — adds `id` to session.user
// ---------------------------------------------------------------------------
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
  }
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

const providers: NextAuthOptions['providers'] = [
  CredentialsProvider({
    id: 'credentials',
    name: 'Email & Password',
    credentials: {
      email: { label: 'Email', type: 'email' },
      password: { label: 'Password', type: 'password' },
    },
    async authorize(credentials) {
      if (!credentials?.email || !credentials.password) return null;

      const user = await db.user.findUnique({
        where: { email: credentials.email.toLowerCase().trim() },
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
          accounts: { where: { provider: 'credentials' }, select: { providerAccountId: true } },
        },
      });

      if (!user) return null;

      // Retrieve hashed password stored as the providerAccountId on the credentials account
      const credAccount = user.accounts[0];
      if (!credAccount) return null;

      const passwordMatch = await bcrypt.compare(
        credentials.password,
        credAccount.providerAccountId,
      );
      if (!passwordMatch) return null;

      return { id: user.id, name: user.name, email: user.email, image: user.image };
    },
  }),
];

// Add Google provider only when env vars are present (not required for local dev)
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  );
}

// ---------------------------------------------------------------------------
// NextAuthOptions
// ---------------------------------------------------------------------------

export const authOptions: NextAuthOptions = {
  // Use Prisma adapter for all OAuth providers + session persistence
  // NOTE: CredentialsProvider sessions use JWT strategy (adapter not used for
  // credentials sign-in itself, but the adapter manages OAuth accounts).
  adapter: PrismaAdapter(db),

  // JWT strategy allows credentials provider to work alongside the Prisma adapter
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },

  providers,

  callbacks: {
    // Persist user.id into the JWT on sign in
    async jwt({ token, user }: { token: JWT; user?: User }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },

    // Expose id on session.user so frontend can read it
    async session({ session, token }: { session: Session; token: JWT }) {
      if (token.id) {
        session.user.id = token.id;
      }
      return session;
    },
  },

  pages: {
    // Custom sign-in page (built by frontend-engineer)
    signIn: '/sign-in',
    error: '/sign-in',
  },

  // NEXTAUTH_SECRET must be set; fail loudly in production
  secret: process.env.NEXTAUTH_SECRET ?? 'dev-secret-change-in-production',

  debug: process.env.NODE_ENV === 'development',
};
