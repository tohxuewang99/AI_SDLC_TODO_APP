import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { todoDB, type CreateTodoInput } from '@/lib/db';
import { getSingaporeNow, isDueDateAtLeastOneMinuteAway, parseSingaporeDateTime, toSingaporeIsoString } from '@/lib/timezone';
import { isPriority, normalizeTodoTitle } from '@/lib/todo-validation';

function invalidBody() {
  return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  return NextResponse.json(todoDB.findAllByUser(session.userId));
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

  if (input.priority !== undefined && !isPriority(input.priority)) {
    return NextResponse.json({ error: 'Priority must be high, medium, or low' }, { status: 400 });
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
    ...(input.priority === undefined ? {} : { priority: input.priority }),
  };
  return NextResponse.json(todoDB.create(session.userId, todoInput), { status: 201 });
}
