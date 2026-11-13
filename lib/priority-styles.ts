import type { Priority } from './priority';

export const PRIORITY_BADGE_STYLES: Record<Priority, string> = {
  high: 'border-[#EF4444] bg-red-100 text-red-800 dark:border-[#F87171] dark:bg-red-950 dark:text-[#F87171]',
  medium: 'border-[#F59E0B] bg-yellow-100 text-yellow-800 dark:border-[#FBBF24] dark:bg-yellow-950 dark:text-[#FBBF24]',
  low: 'border-[#3B82F6] bg-blue-100 text-blue-800 dark:border-[#60A5FA] dark:bg-blue-950 dark:text-[#60A5FA]',
};
