import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { todoDB, type CreateTodoInput, type Priority } from '@/lib/db';
import { getSingaporeNow, isDueDateAtLeastOneMinuteAway, parseSingaporeDateTime, toSingaporeIsoString } from '@/lib/timezone';
import { isPriority, normalizeTodoTitle, validatePriority } from '@/lib/todo-validation';

function invalidBody() {
  return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const priorityValue = new URL(request.url).searchParams.get('priority');
  if (priorityValue === null) {
    return NextResponse.json(todoDB.findAllByUser(session.userId));
  }
  if (!isPriority(priorityValue)) {
    return NextResponse.json({
      error: `Invalid priority: ${priorityValue}. Must be 'high', 'medium', or 'low'.`,
    }, { status: 400 });
  }
  return NextResponse.json(todoDB.findAllByUser(session.userId, priorityValue));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return invalidBody();
  }

  const input = body as Record<string, unknown>;
  const title = normalizeTodoTitle(input.title);
  if (!title) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  }

  let priority: Priority;
  try {
    priority = validatePriority(input.priority);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Invalid priority',
    }, { status: 400 });
  }

  let dueDate: string | null = null;
  if (input.due_date !== undefined && input.due_date !== null) {
    if (typeof input.due_date !== 'string') {
      return NextResponse.json({ error: 'Due date must be a valid date and time' }, { status: 400 });
    }
    const parsedDate = parseSingaporeDateTime(input.due_date);
    if (!parsedDate) {
      return NextResponse.json({ error: 'Due date must be a valid date and time' }, { status: 400 });
    }
    if (!isDueDateAtLeastOneMinuteAway(parsedDate, getSingaporeNow())) {
      return NextResponse.json(
        { error: 'Due date must be at least 1 minute in the future' },
        { status: 400 },
      );
    }
    dueDate = toSingaporeIsoString(parsedDate);
  }

  const todoInput: CreateTodoInput = {
    title,
    due_date: dueDate,
    priority,
  };
  return NextResponse.json(todoDB.create(session.userId, todoInput), { status: 201 });
}
