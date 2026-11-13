import { redirect } from 'next/navigation';
import AuthenticatedControls from '@/app/authenticated-controls';
import { getSession } from '@/lib/auth';
import TodoClient from '@/app/todo-client';
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
      <TodoClient
        initialNow={getSingaporeNow().toISOString()}
        initialTags={tagDB.findAllByUser(session.userId)}
        initialTodos={todoDB.findAllByUser(session.userId)}
        userId={session.userId}
      />
    </main>
  );
}
