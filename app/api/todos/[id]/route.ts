import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { todoDB, type UpdateTodoInput } from '@/lib/db';
import { parseSingaporeDateTime, toSingaporeIsoString } from '@/lib/timezone';
import { isPriority, normalizeTodoTitle } from '@/lib/todo-validation';

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
  const todo = id === null ? undefined : todoDB.findById(id);
  if (!todo || todo.user_id !== session.userId) {
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
  if (id === null) {
    return notFound();
  }
  const existing = todoDB.findById(id);
  if (!existing || existing.user_id !== session.userId) {
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

  const input = body as Record<string, unknown>;
  const updates: UpdateTodoInput = {};
  if (input.title !== undefined) {
    const title = normalizeTodoTitle(input.title);
    if (!title) {
      return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 });
    }
    updates.title = title;
  }
  if (input.priority !== undefined) {
    if (!isPriority(input.priority)) {
      return NextResponse.json({ error: 'Priority must be high, medium, or low' }, { status: 400 });
    }
    updates.priority = input.priority;
  }
  if (input.due_date !== undefined) {
    if (input.due_date === null) {
      updates.due_date = null;
    } else if (typeof input.due_date === 'string') {
      const parsedDate = parseSingaporeDateTime(input.due_date);
      if (!parsedDate) {
        return NextResponse.json({ error: 'Due date must be a valid date and time' }, { status: 400 });
      }
      updates.due_date = toSingaporeIsoString(parsedDate);
    } else {
      return NextResponse.json({ error: 'Due date must be a valid date and time' }, { status: 400 });
    }
  }
  if (input.completed !== undefined) {
    if (typeof input.completed !== 'boolean') {
      return NextResponse.json({ error: 'Completed must be true or false' }, { status: 400 });
    }
    updates.completed = input.completed;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'At least one supported field is required' }, { status: 400 });
  }

  const updated = todoDB.update(id, updates);
  if (!updated) {
    return notFound();
  }
  return NextResponse.json(updated);
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: idParam } = await params;
  const id = parseId(idParam);
  if (id === null) {
    return notFound();
  }
  const existing = todoDB.findById(id);
  if (!existing || existing.user_id !== session.userId) {
    return notFound();
  }

  todoDB.delete(id);
  return NextResponse.json({ success: true });
}
