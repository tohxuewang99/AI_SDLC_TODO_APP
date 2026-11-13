import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import LoginForm from '@/app/login/login-form';

export const instant = false;

export default async function LoginPage() {
  if (await getSession()) {
    redirect('/');
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-6 py-12">
      <section className="w-full rounded-3xl border border-white/60 bg-white/90 p-8 shadow-xl shadow-indigo-950/10 backdrop-blur">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-700">
          Todo App
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">
          Sign in with a passkey
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Register with a username and your device authenticator, or use a
          passkey you have already registered.
        </p>
        <LoginForm />
      </section>
    </main>
  );
}
