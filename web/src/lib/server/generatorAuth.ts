// Generator API-key auth — agentic sprint.
// The market/post generator authenticates with the `x-generator-key` header
// instead of a NextAuth session (see docs/delivery/agentic-sprint-contracts.md §3).

import type { NextRequest } from 'next/server';

/**
 * True iff the request carries header `x-generator-key` matching the non-empty
 * GENERATOR_API_KEY env var. An unset/empty env var always denies.
 */
export function isGeneratorRequest(req: NextRequest): boolean {
  const expected = process.env.GENERATOR_API_KEY;
  if (!expected) return false;
  return req.headers.get('x-generator-key') === expected;
}
