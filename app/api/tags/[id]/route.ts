import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { tagDB, type UpdateTagInput } from '@/lib/db';
import {
  isTagColor,
  isTagNameConflict,
  normalizeTagName,
  parseTagRouteId,
} from '@/lib/tag-validation';

interface RouteContext {
  params: Promise<{ id: string }>;
}

function notFound() {
  return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: idParam } = await params;
  const id = parseTagRouteId(idParam);
  if (id === null || !tagDB.findById(id, session.userId)) {
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
  const updates: UpdateTagInput = {};
  if (input.name !== undefined) {
    const name = normalizeTagName(input.name);
    if (!name) {
      return NextResponse.json({ error: 'Tag name is required' }, { status: 400 });
    }
    updates.name = name;
  }
  if (input.color !== undefined) {
    if (!isTagColor(input.color)) {
      return NextResponse.json({ error: 'Color must be a valid hex code' }, { status: 400 });
    }
    updates.color = input.color;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: 'At least one supported field is required' },
      { status: 400 },
    );
  }

  try {
    const updated = tagDB.update(id, session.userId, updates);
    return updated ? NextResponse.json(updated) : notFound();
  } catch (error) {
    if (isTagNameConflict(error)) {
      return NextResponse.json(
        { error: 'A tag with this name already exists' },
        { status: 409 },
      );
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
  const id = parseTagRouteId(idParam);
  if (id === null || !tagDB.delete(id, session.userId)) {
    return notFound();
  }
  return NextResponse.json({ success: true });
}
