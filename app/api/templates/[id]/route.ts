import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { templateDB } from '@/lib/db';
import { parseTemplateId, parseUpdateTemplateInput } from '@/lib/template-validation';

interface RouteContext {
  params: Promise<{ id: string }>;
}

function notFound() {
  return NextResponse.json({ error: 'Template not found' }, { status: 404 });
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: idParam } = await params;
  const id = parseTemplateId(idParam);
  const existing = id === null ? undefined : templateDB.findById(id, session.userId);
  if (!existing || id === null) return notFound();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
  }

  let input;
  try {
    input = parseUpdateTemplateInput(body, existing);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid template' },
      { status: 400 },
    );
  }
  const updated = templateDB.update(id, session.userId, input);
  return updated ? NextResponse.json(updated) : notFound();
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: idParam } = await params;
  const id = parseTemplateId(idParam);
  if (id === null || !templateDB.delete(id, session.userId)) return notFound();
  return NextResponse.json({ success: true });
}
