import { redirect } from 'next/navigation';
import AuthenticatedControls from '@/app/authenticated-controls';
import { getSession } from '@/lib/auth';

export const instant = false;

export default async function Home() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-10">
      <header className="flex flex-col justify-between gap-6 border-b border-slate-200 pb-8 sm:flex-row sm:items-center">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-700">
            Todo App
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
            Welcome, {session.username}
          </h1>
        </div>
        <AuthenticatedControls username={session.username} />
      </header>
      <section className="mt-10 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-950">Passkey account</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          Your account is protected with passkeys. Add a second device now so you
          have another way to sign in if your primary device is unavailable.
        </p>
        <a
          className="mt-6 inline-flex rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          href="/calendar"
        >
          Open calendar
        </a>
      </section>
    </main>
  );
}
