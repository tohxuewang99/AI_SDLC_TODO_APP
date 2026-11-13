import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { todoDB } from '@/lib/db';
import { toCsv, toExportItem } from '@/lib/todo-transfer';
import { formatSingaporeDate, getSingaporeNow, toSingaporeIsoString } from '@/lib/timezone';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const format = request.nextUrl.searchParams.get('format') ?? 'json';
  if (format !== 'json' && format !== 'csv') {
    return NextResponse.json({ error: 'Invalid export format' }, { status: 400 });
  }
  const todos = todoDB.findAllByUser(session.userId);
  const now = getSingaporeNow();
  const body = format === 'csv'
    ? toCsv(todos)
    : JSON.stringify({ version: 1, exported_at: toSingaporeIsoString(now), todos: todos.map(toExportItem) }, null, 2);
  return new NextResponse(body, {
    headers: {
      'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="todos-${formatSingaporeDate(now, 'yyyy-MM-dd')}.${format}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
