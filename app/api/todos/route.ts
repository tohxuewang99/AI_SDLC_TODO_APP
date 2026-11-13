import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { todoDB } from '@/lib/db';
import { isPriority, parseCreateTodoInput } from '@/lib/todo-validation';

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

  let input;
  try {
    input = parseCreateTodoInput(body);
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Invalid todo',
    }, { status: 400 });
  }

  try {
    return NextResponse.json(todoDB.create(session.userId, input), { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'Tag not found') {
      return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
    }
    throw error;
  }
}
