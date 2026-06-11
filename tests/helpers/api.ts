// HTTP client for the integration suite.
//
// - Cookie jar so the NextAuth session survives across requests (the suite goes
//   through the same auth middleware as production traffic — no hand-crafted sessions).
// - `registerAndSignIn` performs the full credentials dance:
//   register → csrf → credentials callback → session cookie → session check.
//
// Conventions (see tests/README.md):
//   test users:   email `it-…@test.local` (cleanup matches `it-%@test.local`)
//   test markets: question prefixed `IT: ` (cleanup matches `IT: %`)

import { API_BASE_URL, GENERATOR_API_KEY } from './env';

export interface ApiResponse<T> {
  status: number;
  body: T;
}

type RequestBody = string | URLSearchParams | Record<string, unknown> | unknown[] | undefined;

export class ApiClient {
  private readonly baseUrl: string;

  /** cookie name → value (attributes stripped) */
  private readonly cookies = new Map<string, string>();

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  /** Read a stored cookie value (e.g. 'next-auth.session-token'). */
  cookie(name: string): string | undefined {
    return this.cookies.get(name);
  }

  /** Drop all stored cookies (sign the client out locally). */
  clearCookies(): void {
    this.cookies.clear();
  }

  async get<T>(path: string, headers?: Record<string, string>): Promise<ApiResponse<T>> {
    return this.request<T>('GET', path, undefined, headers);
  }

  async post<T>(
    path: string,
    body?: RequestBody,
    headers?: Record<string, string>,
  ): Promise<ApiResponse<T>> {
    return this.request<T>('POST', path, body, headers);
  }

  async del<T>(path: string, body?: RequestBody): Promise<ApiResponse<T>> {
    return this.request<T>('DELETE', path, body);
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    body?: RequestBody,
    headers?: Record<string, string>,
  ): Promise<ApiResponse<T>> {
    const requestHeaders: Record<string, string> = { ...(headers ?? {}) };

    let payload: string | URLSearchParams | undefined;
    if (body === undefined) {
      payload = undefined;
    } else if (typeof body === 'string' || body instanceof URLSearchParams) {
      payload = body;
      // fetch sets application/x-www-form-urlencoded for URLSearchParams automatically;
      // explicit headers (if provided) win.
    } else {
      payload = JSON.stringify(body);
      if (!this.hasHeader(requestHeaders, 'content-type')) {
        requestHeaders['content-type'] = 'application/json';
      }
    }

    const cookieHeader = this.cookieHeader();
    if (cookieHeader && !this.hasHeader(requestHeaders, 'cookie')) {
      requestHeaders['cookie'] = cookieHeader;
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: requestHeaders,
      body: payload,
      // Never follow redirects: NextAuth signals state via 302s and we must not
      // lose set-cookie headers attached to the redirect response.
      redirect: 'manual',
    });

    this.storeCookies(res);

    const text = await res.text();
    let parsed: unknown = text;
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json') && text.length > 0) {
      parsed = JSON.parse(text);
    }

    return { status: res.status, body: parsed as T };
  }

  private hasHeader(headers: Record<string, string>, name: string): boolean {
    const lower = name.toLowerCase();
    return Object.keys(headers).some((k) => k.toLowerCase() === lower);
  }

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  /** Parse every set-cookie header (there can be several) into the jar. */
  private storeCookies(res: Response): void {
    for (const raw of res.headers.getSetCookie()) {
      const pair = raw.split(';', 1)[0];
      if (!pair) continue;
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === '') {
        this.cookies.delete(name); // server cleared the cookie
      } else {
        this.cookies.set(name, value);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Auth helper — register a fresh test user and obtain a NextAuth session
// ---------------------------------------------------------------------------

export interface RegisterAndSignInOptions {
  email?: string;
  password?: string;
  name?: string;
}

export interface TestUser {
  userId: string;
  email: string;
}

const SESSION_COOKIE_NAMES = ['next-auth.session-token', '__Secure-next-auth.session-token'];

/**
 * Register a unique test user and sign it in via the NextAuth credentials provider.
 * The session cookie ends up in the client's jar; subsequent requests through the
 * same client are authenticated.
 *
 * Default email follows the cleanup convention: `it-<timestamp>-<rand>@test.local`.
 */
export async function registerAndSignIn(
  client: ApiClient,
  opts: RegisterAndSignInOptions = {},
): Promise<TestUser> {
  const email =
    opts.email ?? `it-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
  const password = opts.password ?? 'integration1234';
  const name = opts.name ?? `IT User ${email.slice(3, 13)}`;

  // 1. Register
  const reg = await client.post<{ id?: string; error?: string }>('/api/auth/register', {
    email,
    password,
    name,
  });
  if (reg.status !== 201) {
    throw new Error(
      `registerAndSignIn: POST /api/auth/register returned ${reg.status} ` +
        `(${JSON.stringify(reg.body)}) for ${email}`,
    );
  }

  // 2. CSRF token (also sets the next-auth.csrf-token cookie)
  const csrf = await client.get<{ csrfToken?: string }>('/api/auth/csrf');
  const csrfToken = csrf.body.csrfToken;
  if (csrf.status !== 200 || !csrfToken) {
    throw new Error(`registerAndSignIn: GET /api/auth/csrf returned ${csrf.status} without token`);
  }

  // 3. Credentials callback (form-urlencoded, json=true → 200 { url } instead of 302)
  const form = new URLSearchParams({ csrfToken, email, password, json: 'true' });
  const cb = await client.post<{ url?: string }>('/api/auth/callback/credentials', form, {
    'content-type': 'application/x-www-form-urlencoded',
  });
  if (cb.status >= 400) {
    throw new Error(
      `registerAndSignIn: credentials callback returned ${cb.status} (${JSON.stringify(cb.body)})`,
    );
  }
  if (typeof cb.body === 'object' && cb.body !== null && cb.body.url?.includes('error=')) {
    throw new Error(`registerAndSignIn: credentials sign-in rejected: ${cb.body.url}`);
  }
  if (!SESSION_COOKIE_NAMES.some((c) => client.cookie(c) !== undefined)) {
    throw new Error(
      'registerAndSignIn: no session-token cookie after credentials callback ' +
        `(status ${cb.status}, body ${JSON.stringify(cb.body)})`,
    );
  }

  // 4. Verify the session resolves to a user id
  const session = await client.get<{ user?: { id?: string } }>('/api/auth/session');
  const userId = session.body.user?.id;
  if (session.status !== 200 || !userId) {
    throw new Error(
      `registerAndSignIn: GET /api/auth/session returned ${session.status} without user.id ` +
        `(${JSON.stringify(session.body)})`,
    );
  }

  return { userId, email };
}

/** Headers for generator-authenticated requests (POST /api/markets, /api/posts, /api/faucet). */
export function generatorHeaders(): { 'x-generator-key': string } {
  return { 'x-generator-key': GENERATOR_API_KEY };
}
