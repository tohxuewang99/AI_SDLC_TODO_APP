import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { tagDB } from '@/lib/db';
import { parseTagId, parseTagRouteId } from '@/lib/tag-validation';

interface RouteContext {
  params: Promise<{ id: string }>;
}

function notFound() {
  return NextResponse.json({ error: 'Todo or tag not found' }, { status: 404 });
}

async function updateAssociation(
  request: NextRequest,
  params: Promise<{ id: string }>,
  attach: boolean,
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: todoIdParam } = await params;
  const todoId = parseTagRouteId(todoIdParam);
  if (todoId === null) {
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
  const tagId = parseTagId((body as Record<string, unknown>).tag_id);
  if (tagId === null) {
    return NextResponse.json({ error: 'Tag ID must be a positive integer' }, { status: 400 });
  }

  const success = attach
    ? tagDB.attachToTodo(todoId, tagId, session.userId)
    : tagDB.detachFromTodo(todoId, tagId, session.userId);
  if (!success) {
    return notFound();
  }
  return NextResponse.json({ success: true });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  return updateAssociation(request, params, true);
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  return updateAssociation(request, params, false);
}
