import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { tagDB } from '@/lib/db';
import { isTagColor, isTagNameConflict, normalizeTagName } from '@/lib/tag-validation';

function invalidBody() {
  return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  return NextResponse.json(tagDB.findAllByUser(session.userId));
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
  const name = normalizeTagName(input.name);
  if (!name) {
    return NextResponse.json({ error: 'Tag name is required' }, { status: 400 });
  }
  const color = input.color;
  if (color !== undefined && !isTagColor(color)) {
    return NextResponse.json({ error: 'Color must be a valid hex code' }, { status: 400 });
  }

  try {
    return NextResponse.json(tagDB.create(session.userId, name, color), { status: 201 });
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
