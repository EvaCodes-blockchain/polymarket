'use client';

import { useEffect, useRef, useState } from 'react';
import { signIn } from 'next-auth/react';

// ── Wallet SVG icons (identical markup to prototype) ──────────────────────────

const MetaMaskIcon = () => (
  <svg width="40" height="40" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M27.2684 4.03027L17.5018 11.2841L19.3079 7.00442L27.2684 4.03027Z" fill="#E2761B" stroke="#E2761B" strokeWidth="0.27" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M4.7218 4.03027L14.4099 11.3528L12.6921 7.00442L4.7218 4.03027Z" fill="#E4761B" stroke="#E4761B" strokeWidth="0.27" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M23.7544 20.8438L21.1532 24.8289L26.7187 26.3602L28.3187 20.9321L23.7544 20.8438Z" fill="#E4761B" stroke="#E4761B" strokeWidth="0.27" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M3.69104 20.9321L5.28117 26.3602L10.8467 24.8289L8.24551 20.8438L3.69104 20.9321Z" fill="#E4761B" stroke="#E4761B" strokeWidth="0.27" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M10.5327 14.1108L8.98181 16.4568L14.5081 16.7022L14.3117 10.7637L10.5327 14.1108Z" fill="#E4761B" stroke="#E4761B" strokeWidth="0.27" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M21.4576 14.1111L17.6295 10.6953L17.5018 16.7025L23.0182 16.4571L21.4576 14.1111Z" fill="#E4761B" stroke="#E4761B" strokeWidth="0.27" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M10.8469 24.8292L14.1647 23.2096L11.2984 20.9717L10.8469 24.8292Z" fill="#E4761B" stroke="#E4761B" strokeWidth="0.27" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M17.8257 23.2096L21.1531 24.8292L20.6918 20.9717L17.8257 23.2096Z" fill="#E4761B" stroke="#E4761B" strokeWidth="0.27" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const TrustWalletIcon = () => (
  <svg width="40" height="40" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="44" height="44" fill="#ffffff" rx="8"/>
    <path fillRule="evenodd" clipRule="evenodd" d="M33.0246 11.8662C33.4096 11.8662 33.774 12.0243 34.0421 12.2925C34.3102 12.5675 34.4615 12.9387 34.4546 13.3168C34.3859 17.4143 34.2277 20.5493 33.9321 23.0312C33.6433 25.5131 33.2102 27.3556 32.5571 28.8475C32.1171 29.8443 31.574 30.6693 30.9346 31.3706C30.0752 32.2987 29.0921 32.9725 28.0196 33.6119C27.561 33.8861 27.0843 34.1568 26.5842 34.4408C25.5172 35.0468 24.3441 35.713 23.0146 36.6025C22.5333 36.9256 21.9077 36.9256 21.4265 36.6025C20.0766 35.7026 18.8879 35.0281 17.8112 34.4173C17.5718 34.2815 17.3379 34.1488 17.109 34.0175C15.8509 33.2887 14.7165 32.5943 13.7265 31.5906C13.0665 30.9306 12.4959 30.1262 12.0421 29.1706C11.4234 27.8918 11.004 26.345 10.6946 24.3443C10.2821 21.67 10.0759 18.1706 10.0002 13.3168C9.99336 12.9387 10.1377 12.5675 10.4059 12.2925C10.674 12.0243 11.0452 11.8662 11.4302 11.8662H33.0246Z" fill="#3375BB"/>
  </svg>
);

const CoinbaseIcon = () => (
  <svg width="40" height="40" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="10" cy="10" r="10" fill="#0052FF"/>
    <path fillRule="evenodd" clipRule="evenodd" d="M10.0001 17C13.8661 17 17.0001 13.866 17.0001 10C17.0001 6.13401 13.8661 3 10.0001 3C6.13413 3 3.00012 6.13401 3.00012 10C3.00012 13.866 6.13413 17 10.0001 17ZM8.25012 7.71429C7.95427 7.71429 7.71441 7.95414 7.71441 8.25V11.75C7.71441 12.0459 7.95427 12.2857 8.25012 12.2857H11.7501C12.046 12.2857 12.2858 12.0459 12.2858 11.75V8.25C12.2858 7.95414 12.046 7.71429 11.7501 7.71429H8.25012Z" fill="white"/>
  </svg>
);

const WalletConnectIcon = () => (
  <svg width="40" height="40" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M9.58818 11.8556C13.1293 8.31442 18.8706 8.31442 22.4117 11.8556L22.8379 12.2818C23.015 12.4588 23.015 12.7459 22.8379 12.9229L21.3801 14.3808C21.2915 14.4693 21.148 14.4693 21.0595 14.3808L20.473 13.7943C18.0026 11.3239 13.9973 11.3239 11.5269 13.7943L10.8989 14.4223C10.8104 14.5109 10.6668 14.5109 10.5783 14.4223L9.12041 12.9645C8.94336 12.7875 8.94336 12.5004 9.12041 12.3234L9.58818 11.8556Z" fill="#3B99FC"/>
    <path d="M25.4268 14.8706L26.7243 16.1682C26.9013 16.3452 26.9013 16.6323 26.7243 16.8093L20.8737 22.6599C20.6966 22.8371 20.4096 22.8371 20.2325 22.6599L16.0802 18.5076C16.0359 18.4634 15.9641 18.4634 15.9199 18.5076L11.7675 22.6599C11.5905 22.8371 11.3034 22.8371 11.1264 22.66L5.27561 16.8092C5.09856 16.6322 5.09856 16.3451 5.27561 16.168L6.57313 14.8706C6.75019 14.6934 7.03726 14.6934 7.21431 14.8706L11.3668 19.023C11.411 19.0672 11.4828 19.0672 11.5271 19.023L15.6793 14.8706C15.8563 14.6934 16.1434 14.6934 16.3205 14.8706L20.473 19.023C20.5172 19.0672 20.589 19.0672 20.6332 19.023L24.7856 14.8706C24.9627 14.6935 25.2498 14.6935 25.4268 14.8706Z" fill="#3B99FC"/>
  </svg>
);

// ─────────────────────────────────────────────────────────────────────────────

type Mode = 'signin' | 'register';

interface SignInModalProps {
  open: boolean;
  onClose: () => void;
}

export default function SignInModal({ open, onClose }: SignInModalProps) {
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setMode('signin');
      setName('');
      setEmail('');
      setPassword('');
      setError('');
      setLoading(false);
    }
  }, [open]);

  // Close on backdrop click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (e.target === backdropRef.current) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'register') {
        // POST /api/auth/register (backend-engineer's route)
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password }),
        });
        const data: { error?: string } = await res.json() as { error?: string };
        if (!res.ok) {
          setError(data.error ?? 'Registration failed');
          setLoading(false);
          return;
        }
        // Auto sign-in after registration
      }

      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError('Invalid email or password');
        setLoading(false);
        return;
      }

      // Success — close modal, page will re-render with session
      onClose();
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="signin-title"
    >
      <div className="relative bg-glass rounded-2xl shadow-2xl p-8 w-full max-w-sm mx-4 border border-white/10">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-white material-icons md-20 transition-colors"
          aria-label="Close"
        >
          close
        </button>

        <div className="login-modal">
          <h2 className="login-title" id="signin-title">
            Welcome to Justify
          </h2>

          {/* Google (only when env vars present — shown always per prototype, deactivates in local dev) */}
          <button
            type="button"
            onClick={() => signIn('google', { callbackUrl: '/' })}
            className="btn-google"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://www.svgrepo.com/show/475656/google-color.svg"
              alt="Google"
              width={20}
              height={20}
            />
            Continue with Google
          </button>

          {/* Divider */}
          <div className="login-divider">OR</div>

          {/* Mode toggle */}
          <div className="flex rounded-xl overflow-hidden border border-white/10">
            <button
              type="button"
              onClick={() => { setMode('signin'); setError(''); }}
              className={`flex-1 py-2 text-sm font-medium transition-colors
                ${mode === 'signin' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setMode('register'); setError(''); }}
              className={`flex-1 py-2 text-sm font-medium transition-colors
                ${mode === 'register' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              Register
            </button>
          </div>

          {/* Form */}
          <form className="login-form space-y-3" onSubmit={handleCredentials}>
            {mode === 'register' && (
              <input
                type="text"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
              />
            )}
            <input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            />

            {error && (
              <p className="text-red-400 text-xs text-center">{error}</p>
            )}

            <button type="submit" disabled={loading}>
              {loading ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Continue'}
            </button>
          </form>

          {/* Wallets — MetaMask wired in CEO-3 (task #13), others shown-but-disabled */}
          <div className="login-wallets gap-4">
            <button
              type="button"
              title="MetaMask — connect wallet (CEO-3)"
              className="hover:opacity-80 transition-opacity"
              onClick={() => {
                onClose();
                // CEO-3: wagmi connect dispatched via event; task #13 wires this
                window.dispatchEvent(new CustomEvent('justify:connectWallet'));
              }}
            >
              <MetaMaskIcon />
            </button>
            <button
              type="button"
              title="Trust Wallet (coming soon)"
              disabled
              className="opacity-40 cursor-not-allowed"
            >
              <TrustWalletIcon />
            </button>
            <button
              type="button"
              title="Coinbase Wallet (coming soon)"
              disabled
              className="opacity-40 cursor-not-allowed"
            >
              <CoinbaseIcon />
            </button>
            <button
              type="button"
              title="WalletConnect (coming soon)"
              disabled
              className="opacity-40 cursor-not-allowed"
            >
              <WalletConnectIcon />
            </button>
          </div>

          {/* Terms — FR-AUTH-5 */}
          <p className="login-terms">
            By continuing, you agree to our{' '}
            <a href="/terms">Terms</a> and <a href="/privacy">Privacy</a>.
          </p>
        </div>
      </div>
    </div>
  );
}
