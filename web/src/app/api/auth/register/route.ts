// POST /api/auth/register — create a new user with email + password
//
// REQUEST BODY (JSON):
//   { email: string, password: string, name?: string }
//
// RESPONSES:
//   201 { id, email, name }     — user created
//   400 { error: string }       — validation error
//   409 { error: string }       — email already registered
//   500 { error: string }       — unexpected server error
//
// After registering, the client should call NextAuth signIn('credentials', { email, password })
// to obtain a session. This route does NOT issue a session itself.

import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/lib/server/db';

const BCRYPT_ROUNDS = 12;

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as unknown;

    // --- Input validation ---
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { email, password, name } = body as Record<string, unknown>;

    if (typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // --- Duplicate check ---
    const existing = await db.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
    }

    // --- Create user + credentials account atomically ---
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const user = await db.user.create({
      data: {
        email: normalizedEmail,
        name: typeof name === 'string' && name.trim() ? name.trim() : null,
        accounts: {
          create: {
            type: 'credentials',
            provider: 'credentials',
            // Store the bcrypt hash as providerAccountId — the credentials provider
            // in auth.ts reads and verifies it on each sign-in.
            providerAccountId: passwordHash,
          },
        },
      },
      select: { id: true, email: true, name: true },
    });

    return NextResponse.json(user, { status: 201 });
  } catch (err) {
    console.error('[register] unexpected error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
