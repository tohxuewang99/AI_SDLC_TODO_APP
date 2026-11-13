import { holidayDB } from '../lib/db.ts';
import { SINGAPORE_HOLIDAYS } from '../lib/holidays.ts';

holidayDB.seed(SINGAPORE_HOLIDAYS);
process.stdout.write(`Seeded ${SINGAPORE_HOLIDAYS.length} Singapore holidays (2025-2027).\n`);
