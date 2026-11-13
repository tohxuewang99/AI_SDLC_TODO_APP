'use client';

import { startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface ApiError {
  error?: string;
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = result as ApiError | null;
    throw new Error(error?.error ?? 'The request could not be completed.');
  }
  return result as T;
}

export default function AuthenticatedControls({ username }: { username: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function addPasskey() {
    setMessage(null);
    setBusy(true);
    try {
      const options = await postJson<PublicKeyCredentialCreationOptionsJSON>(
        '/api/auth/register-options',
        { username },
      );
      const response = await startRegistration({ optionsJSON: options });
      await postJson('/api/auth/register-verify', { username, response });
      setMessage('Passkey added to your account.');
      router.refresh();
    } catch (error) {
      if (typeof PublicKeyCredential === 'undefined' || !window.isSecureContext) {
        setMessage('This browser or device does not support passkeys on this connection.');
      } else if (error instanceof DOMException && error.name === 'NotAllowedError') {
        setMessage('Passkey prompt canceled. You can try again.');
      } else {
        setMessage(error instanceof Error ? error.message : 'Could not add passkey.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setMessage(null);
    setBusy(true);
    try {
      await postJson('/api/auth/logout');
      router.replace('/login');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not log out.');
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-3 sm:items-end">
      <div className="flex flex-wrap gap-3">
        <button
          className="rounded-xl border border-indigo-200 bg-white px-4 py-2 text-sm font-semibold text-indigo-800 hover:bg-indigo-50 disabled:opacity-60"
          disabled={busy}
          onClick={addPasskey}
          type="button"
        >
          {busy ? 'Working…' : 'Add another passkey'}
        </button>
        <button
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
          disabled={busy}
          onClick={logout}
          type="button"
        >
          Log out
        </button>
      </div>
      {message && (
        <p className="text-sm text-slate-600" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
