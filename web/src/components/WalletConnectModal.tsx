'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { useSession } from 'next-auth/react';
import { ganache, buildWalletSignMessage } from '@/lib/client/wagmi';

type Step = 'idle' | 'connecting' | 'switching-chain' | 'signing' | 'binding' | 'done' | 'error';

interface WalletConnectModalProps {
  open: boolean;
  onClose: () => void;
  /** Called after wallet is successfully bound */
  onBound?: (address: string) => void;
}

/**
 * MetaMask connect modal (CEO-3).
 *
 * Flow:
 * 1. connect MetaMask (injected)
 * 2. verify / switch to chain 1337 (Ganache)
 * 3. personal_sign the Justify message with nonce = session.user.id
 * 4. POST /api/wallet { address, message, signature }
 * 5. show bound address
 *
 * Other wallets (Trust, Coinbase, WalletConnect) are rendered disabled.
 */
export default function WalletConnectModal({ open, onClose, onBound }: WalletConnectModalProps) {
  const { data: session } = useSession();
  const { address, isConnected, chain } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();

  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [boundAddress, setBoundAddress] = useState<string | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setStep('idle');
      setError(null);
      setBoundAddress(null);
    }
  }, [open]);

  const handleConnect = useCallback(async () => {
    if (!session?.user?.id) {
      setError('You must be signed in to connect a wallet.');
      return;
    }

    setError(null);

    try {
      // Step 1: Connect MetaMask
      let currentAddress = address;
      if (!isConnected) {
        setStep('connecting');
        const metaMask = connectors.find((c) => c.id === 'metaMask' || c.name === 'MetaMask');
        if (!metaMask) {
          throw new Error('MetaMask not found. Please install the MetaMask browser extension.');
        }
        const result = await connectAsync({ connector: metaMask });
        currentAddress = result.accounts[0];
      }

      if (!currentAddress) {
        throw new Error('No account returned from MetaMask.');
      }

      // Step 2: Switch to chain 1337 if needed
      if (chain?.id !== ganache.id) {
        setStep('switching-chain');
        await switchChainAsync({ chainId: ganache.id });
      }

      // Step 3: Sign message
      setStep('signing');
      const message = buildWalletSignMessage(session.user.id);

      // Use window.ethereum directly for personal_sign (more reliable than wagmi for non-typed sigs)
      const ethereum = (window as typeof window & { ethereum?: { request: (args: { method: string; params: unknown[] }) => Promise<unknown> } }).ethereum;
      if (!ethereum) {
        throw new Error('MetaMask is not available. Please install it.');
      }
      const signature = (await ethereum.request({
        method: 'personal_sign',
        params: [message, currentAddress],
      })) as string;

      // Step 4: Bind wallet
      setStep('binding');
      const res = await fetch('/api/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: currentAddress, message, signature }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `Bind failed (${res.status})`);
      }

      // Step 5: Done
      setStep('done');
      setBoundAddress(currentAddress);
      onBound?.(currentAddress);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // User rejected signature — friendly message
      const friendly = msg.includes('rejected') || msg.includes('denied') || msg.includes('4001')
        ? 'Signature cancelled.'
        : msg;
      setStep('error');
      setError(friendly);
    }
  }, [session, address, isConnected, chain, connectors, connectAsync, switchChainAsync, onBound]);

  if (!open) return null;

  const WALLETS = [
    { id: 'metamask', label: 'MetaMask', icon: '🦊', active: true },
    { id: 'trust', label: 'Trust Wallet', icon: '🛡', active: false },
    { id: 'coinbase', label: 'Coinbase Wallet', icon: '🔵', active: false },
    { id: 'walletconnect', label: 'WalletConnect', icon: '🔗', active: false },
  ];

  const stepLabel: Record<Step, string> = {
    idle: 'Connect',
    connecting: 'Opening MetaMask…',
    'switching-chain': 'Switching to Ganache (1337)…',
    signing: 'Sign message in MetaMask…',
    binding: 'Binding wallet…',
    done: 'Connected!',
    error: 'Try again',
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        {/* Modal */}
        <div
          className="bg-glass border border-white/10 rounded-2xl p-6 w-full max-w-sm shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-white font-bold text-lg">Connect Wallet</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white material-icons transition-colors"
              aria-label="Close"
            >
              close
            </button>
          </div>

          {step === 'done' && boundAddress ? (
            /* Success state */
            <div className="text-center py-4">
              <div className="text-4xl mb-3">✅</div>
              <p className="text-white font-semibold mb-1">Wallet connected!</p>
              <p className="text-gray-400 text-xs font-mono break-all">{boundAddress}</p>
              <button
                onClick={onClose}
                className="mt-4 w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm transition-colors"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              {/* Session guard */}
              {!session && (
                <p className="text-yellow-400 text-sm mb-4 bg-yellow-400/10 rounded-xl px-3 py-2">
                  Sign in first to connect a wallet.
                </p>
              )}

              {/* Wallet list */}
              <div className="space-y-2">
                {WALLETS.map((w) => (
                  <button
                    key={w.id}
                    disabled={!w.active || !session || (step !== 'idle' && step !== 'error')}
                    onClick={w.active ? handleConnect : undefined}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors text-sm font-medium
                      ${w.active && session
                        ? 'border-indigo-500/50 bg-indigo-500/10 text-white hover:bg-indigo-500/20 cursor-pointer'
                        : 'border-white/10 bg-white/5 text-gray-500 cursor-not-allowed opacity-40'
                      }
                      ${(step !== 'idle' && step !== 'error') ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <span className="text-xl">{w.icon}</span>
                    <span>{w.label}</span>
                    {w.active && (
                      <span className="ml-auto text-xs text-indigo-400">Active</span>
                    )}
                  </button>
                ))}
              </div>

              {/* Status */}
              {step !== 'idle' && step !== 'error' && (
                <div className="mt-4 flex items-center gap-2 text-sm text-indigo-300">
                  <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  <span>{stepLabel[step]}</span>
                </div>
              )}

              {/* Error */}
              {error && (
                <div className="mt-3 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2">
                  <p className="text-red-400 text-xs">{error}</p>
                </div>
              )}

              {/* Chain info */}
              <p className="mt-4 text-center text-xs text-gray-500">
                Requires Ganache · Chain ID 1337 · localhost:8545
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}
