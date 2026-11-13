import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tagDB } from '@/lib/db';

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  return NextResponse.json(tagDB.findAllByUser(session.userId));
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 });
  }

  const { name, color } = body as { name?: unknown; color?: unknown };
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Tag name is required' }, { status: 400 });
  }
  if (color !== undefined && (typeof color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(color))) {
    return NextResponse.json({ error: 'Color must be a valid hex code' }, { status: 400 });
  }

  try {
    return NextResponse.json(
      tagDB.create(session.userId, name.trim(), color as string | undefined),
      { status: 201 },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('UNIQUE constraint failed: tags.user_id, tags.name')
    ) {
      return NextResponse.json(
        { error: 'A tag with this name already exists' },
        { status: 409 },
      );
    }
    throw error;
  }
}
