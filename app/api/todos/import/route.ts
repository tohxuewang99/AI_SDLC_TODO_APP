import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { todoDB } from '@/lib/db';
import { todoExportSchema } from '@/lib/todo-transfer';

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON format' }, { status: 400 });
  }
  const parsed = todoExportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Failed to import todos. Please check the file format.' },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json({ success: true, ...todoDB.importAll(session.userId, parsed.data.todos) });
  } catch (error) {
    console.error('Import failed:', error);
    return NextResponse.json({ error: 'Failed to import todos' }, { status: 500 });
  }
}
