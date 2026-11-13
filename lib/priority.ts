export type Priority = 'high' | 'medium' | 'low';

export const PRIORITY_VALUES: Priority[] = ['high', 'medium', 'low'];

export const PRIORITY_ORDER: Record<Priority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};
