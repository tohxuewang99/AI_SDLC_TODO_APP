'use client';

import {
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface ApiError {
  error?: string;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = result as ApiError | null;
    throw new Error(error?.error ?? 'The request could not be completed.');
  }
  return result as T;
}

function getPasskeyError(error: unknown): string {
  if (typeof PublicKeyCredential === 'undefined' || !window.isSecureContext) {
    return 'This browser or device does not support passkeys on this connection.';
  }
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Passkey prompt canceled. You can try again.';
  }
  if (error instanceof DOMException && error.name === 'NotSupportedError') {
    return 'This browser or device does not support passkeys.';
  }
  return error instanceof Error ? error.message : 'Passkey authentication failed.';
}

export default function LoginForm() {
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function handleRegister() {
    setError(null);
    setBusy(true);
    try {
      const options = await postJson<PublicKeyCredentialCreationOptionsJSON>(
        '/api/auth/register-options',
        { username },
      );
      const response = await startRegistration({ optionsJSON: options });
      await postJson<{ success: boolean }>('/api/auth/register-verify', {
        username,
        response,
      });
      router.replace('/');
      router.refresh();
    } catch (requestError) {
      setError(getPasskeyError(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin() {
    setError(null);
    setBusy(true);
    try {
      const options = await postJson<PublicKeyCredentialRequestOptionsJSON>(
        '/api/auth/login-options',
        { username },
      );
      const response = await startAuthentication({ optionsJSON: options });
      await postJson<{ success: boolean }>('/api/auth/login-verify', {
        username,
        response,
      });
      router.replace('/');
      router.refresh();
    } catch (requestError) {
      setError(getPasskeyError(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 space-y-5">
      <div>
        <label
          className="mb-2 block text-sm font-medium text-slate-800"
          htmlFor="username"
        >
          Username
        </label>
        <input
          autoComplete="username webauthn"
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-950 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
          id="username"
          maxLength={64}
          onChange={(event) => setUsername(event.target.value)}
          required
          value={username}
        />
      </div>
      {error && (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
          {error}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          className="rounded-xl bg-indigo-700 px-5 py-3 font-semibold text-white transition hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={busy || !username.trim()}
          onClick={handleRegister}
          type="button"
        >
          {busy ? 'Waiting for passkey…' : 'Register'}
        </button>
        <button
          className="rounded-xl border border-slate-300 bg-white px-5 py-3 font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={busy || !username.trim()}
          onClick={handleLogin}
          type="button"
        >
          Login
        </button>
      </div>
    </div>
  );
}
