import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { subtaskDB, todoDB } from '@/lib/db';
import { normalizeSubtaskTitle, parseSubtaskId } from '@/lib/subtask-validation';

interface RouteContext {
  params: Promise<{ id: string }>;
}

function notFound() {
  return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: idParam } = await params;
  const todoId = parseSubtaskId(idParam);
  if (todoId === null) {
    return notFound();
  }
  const todo = todoDB.findById(todoId);
  if (!todo || todo.user_id !== session.userId) {
    return notFound();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
  }

  const title = normalizeSubtaskTitle((body as Record<string, unknown>).title);
  if (!title) {
    return NextResponse.json({ error: 'Subtask title is required' }, { status: 400 });
  }

  const currentTodo = todoDB.findById(todoId);
  if (!currentTodo || currentTodo.user_id !== session.userId) {
    return notFound();
  }

  return NextResponse.json(subtaskDB.create(todoId, { title }), { status: 201 });
}
