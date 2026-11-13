import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { todoDB } from '@/lib/db';
import { parseUpdateTodoInput } from '@/lib/todo-validation';

interface RouteContext {
  params: Promise<{ id: string }>;
}

function parseId(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) {
    return null;
  }
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function notFound() {
  return NextResponse.json({ error: 'Todo not found' }, { status: 404 });
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: idParam } = await params;
  const id = parseId(idParam);
  const todo = id === null ? undefined : todoDB.findById(id, session.userId);
  if (!todo) {
    return notFound();
  }
  return NextResponse.json(todo);
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: idParam } = await params;
  const id = parseId(idParam);
  const existing = id === null ? undefined : todoDB.findById(id, session.userId);
  if (!existing || id === null) {
    return notFound();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
  }

  let input;
  try {
    input = parseUpdateTodoInput(body, existing);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid todo' },
      { status: 400 },
    );
  }

  try {
    const result = todoDB.updateAndMaybeRecur(id, session.userId, input);
    if (!result) {
      return notFound();
    }
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Tag not found') {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }
    throw error;
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: idParam } = await params;
  const id = parseId(idParam);
  if (id === null || !todoDB.delete(id, session.userId)) {
    return notFound();
  }
  return NextResponse.json({ success: true });
}
