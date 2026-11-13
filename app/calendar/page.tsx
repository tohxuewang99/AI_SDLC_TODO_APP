import { redirect } from 'next/navigation';
import Link from 'next/link';
import AuthenticatedControls from '@/app/authenticated-controls';
import { getSession } from '@/lib/auth';

export const instant = false;

export default async function CalendarPage() {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-10">
      <header className="flex flex-col justify-between gap-6 border-b border-slate-200 pb-8 sm:flex-row sm:items-center">
        <div>
          <Link className="text-sm font-semibold text-indigo-700 hover:text-indigo-900" href="/">
            Todo App
          </Link>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
            Calendar
          </h1>
        </div>
        <AuthenticatedControls username={session.username} />
      </header>
      <p className="mt-8 text-slate-600">
        Calendar features will be added in a later task.
      </p>
    </main>
  );
}
