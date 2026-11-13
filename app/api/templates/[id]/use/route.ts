import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { templateDB } from '@/lib/db';
import { parseTemplateId } from '@/lib/template-validation';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: NextRequest, { params }: RouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id: idParam } = await params;
  const id = parseTemplateId(idParam);
  if (id === null) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  try {
    const todo = templateDB.use(id, session.userId);
    if (!todo) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }
    return NextResponse.json(todo, { status: 201 });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === 'Recurring templates require a due date offset' ||
        error.message === 'Templates with reminders require a due date offset')
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
