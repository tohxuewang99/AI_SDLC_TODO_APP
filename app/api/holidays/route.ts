import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { holidayDB } from '@/lib/db';

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  const params = request.nextUrl.searchParams;
  const year = params.get('year');
  const month = params.get('month');
  if (year === null && month === null) {
    return NextResponse.json({ holidays: holidayDB.findAll() });
  }
  if (!year || !month || !/^\d{4}$/.test(year) || !/^\d{1,2}$/.test(month)
    || Number(year) < 1 || Number(month) < 1 || Number(month) > 12) {
    return NextResponse.json(
      { error: 'Provide both year (0001-9999) and month (1-12)' },
      { status: 400 },
    );
  }
  return NextResponse.json({ holidays: holidayDB.findByMonth(Number(year), Number(month)) });
}
