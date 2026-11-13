import { redirect } from 'next/navigation';
import Link from 'next/link';
import AuthenticatedControls from '@/app/authenticated-controls';
import TodoClient from '@/app/todo-client';
import { getSession } from '@/lib/auth';
import { tagDB, todoDB } from '@/lib/db';
import { getSingaporeNow } from '@/lib/timezone';

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
      <nav aria-label="Views" className="mt-6">
        <Link href="/calendar" className="inline-block rounded-xl bg-purple-700 px-4 py-2 font-semibold text-white hover:bg-purple-800">
          Calendar
        </Link>
      </nav>
      <TodoClient
        initialNow={getSingaporeNow().toISOString()}
        initialTags={tagDB.findAllByUser(session.userId)}
        initialTodos={todoDB.findAllByUser(session.userId)}
        userId={session.userId}
      />
      <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
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
