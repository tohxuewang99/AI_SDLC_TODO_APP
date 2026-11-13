import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { subtaskDB, todoDB, type UpdateSubtaskDto } from '@/lib/db';
import { normalizeSubtaskTitle, parseSubtaskId } from '@/lib/subtask-validation';

interface RouteContext {
  params: Promise<{ id: string }>;
}

function notFound() {
  return NextResponse.json({ error: 'Subtask not found' }, { status: 404 });
}

function findOwnedSubtask(idParam: string, userId: number) {
  const id = parseSubtaskId(idParam);
  if (id === null) {
    return undefined;
  }
  const subtask = subtaskDB.findById(id);
  if (!subtask) {
    return undefined;
  }
  const todo = todoDB.findById(subtask.todo_id, userId);
  if (!todo) {
    return undefined;
  }
  return subtask;
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: idParam } = await params;
  const existing = findOwnedSubtask(idParam, session.userId);
  if (!existing) {
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
  const updates: UpdateSubtaskDto = {};
  if (input.title !== undefined) {
    const title = normalizeSubtaskTitle(input.title);
    if (!title) {
      return NextResponse.json({ error: 'Subtask title is required' }, { status: 400 });
    }
    updates.title = title;
  }
  if (input.completed !== undefined) {
    if (typeof input.completed !== 'boolean') {
      return NextResponse.json({ error: 'Completed must be true or false' }, { status: 400 });
    }
    updates.completed = input.completed;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: 'At least one supported field is required' },
      { status: 400 },
    );
  }

  const subtaskId = parseSubtaskId(idParam);
  if (subtaskId === null || !findOwnedSubtask(idParam, session.userId)) {
    return notFound();
  }
  const updated = subtaskDB.update(subtaskId, updates);
  return updated ? NextResponse.json(updated) : notFound();
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: idParam } = await params;
  const existing = findOwnedSubtask(idParam, session.userId);
  if (!existing) {
    return notFound();
  }

  const id = parseSubtaskId(idParam);
  if (id === null || !subtaskDB.delete(id)) {
    return notFound();
  }
  return NextResponse.json({ success: true });
}
