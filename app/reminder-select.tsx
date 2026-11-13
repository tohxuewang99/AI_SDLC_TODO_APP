'use client';

import { REMINDER_LABELS, type ReminderMinutes } from '@/lib/reminders';

const optionLabels: Record<ReminderMinutes, string> = {
  15: '15 minutes before',
  30: '30 minutes before',
  60: '1 hour before',
  120: '2 hours before',
  1440: '1 day before',
  2880: '2 days before',
  10080: '1 week before',
};

export default function ReminderSelect({
  value,
  disabled,
  onChange,
  label = 'Reminder',
}: {
  value: number | null;
  disabled: boolean;
  onChange: (value: ReminderMinutes | null) => void;
  label?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">Reminder</span>
      <select
        aria-label={label}
        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 disabled:opacity-60"
        disabled={disabled}
        onChange={(event) => onChange(
          event.target.value === '' ? null : Number(event.target.value) as ReminderMinutes,
        )}
        value={value ?? ''}
      >
        <option value="">None</option>
        {(Object.keys(REMINDER_LABELS).map(Number) as ReminderMinutes[]).map((minutes) => (
          <option key={minutes} value={minutes}>{optionLabels[minutes]}</option>
        ))}
      </select>
      {disabled && (
        <span className="mt-1 block text-xs text-slate-500">Set a due date to enable reminders.</span>
      )}
    </label>
  );
}
