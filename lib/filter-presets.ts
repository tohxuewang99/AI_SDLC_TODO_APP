import type { FilterState } from './filters';

export interface FilterPreset {
  id: string;
  name: string;
  filters: FilterState;
  createdAt: string;
}

const PRESETS_KEY = 'todo-app:filter-presets';

type PresetStorage = Pick<Storage, 'getItem' | 'setItem'>;

function getStorage(storage?: PresetStorage): PresetStorage {
  if (storage) return storage;
  if (typeof globalThis.localStorage === 'undefined') {
    throw new Error('localStorage is unavailable');
  }
  return globalThis.localStorage;
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isOptionalDate(value: unknown): value is string | null {
  return value === null || isDate(value);
}

function isFilterState(value: unknown): value is FilterState {
  if (!value || typeof value !== 'object') return false;
  const filters = value as Record<string, unknown>;
  const priorityValid = filters.priority === 'all'
    || filters.priority === 'high'
    || filters.priority === 'medium'
    || filters.priority === 'low';
  const tagValid = filters.tagId === 'all'
    || (typeof filters.tagId === 'number' && Number.isSafeInteger(filters.tagId) && filters.tagId > 0);

  return typeof filters.search === 'string'
    && priorityValid
    && tagValid
    && (filters.completion === 'all' || filters.completion === 'incomplete' || filters.completion === 'completed')
    && isOptionalDate(filters.dueDateFrom)
    && isOptionalDate(filters.dueDateTo);
}

function isFilterPreset(value: unknown): value is FilterPreset {
  if (!value || typeof value !== 'object') return false;
  const preset = value as Record<string, unknown>;
  return typeof preset.id === 'string'
    && preset.id.length > 0
    && typeof preset.name === 'string'
    && preset.name.trim().length > 0
    && isFilterState(preset.filters)
    && typeof preset.createdAt === 'string'
    && !Number.isNaN(Date.parse(preset.createdAt));
}

function readPresets(storage: PresetStorage): FilterPreset[] {
  const raw = storage.getItem(PRESETS_KEY);
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error('Failed to parse filter presets:', error);
    return [];
  }

  if (!Array.isArray(parsed) || !parsed.every(isFilterPreset)) {
    console.error('Invalid filter preset data in localStorage');
    return [];
  }
  return parsed;
}

export function loadPresets(storage?: PresetStorage): FilterPreset[] {
  try {
    return readPresets(getStorage(storage));
  } catch (error) {
    console.error('Failed to load filter presets:', error);
    return [];
  }
}

function isQuotaExceeded(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return candidate.name === 'QuotaExceededError'
    || candidate.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || candidate.code === 22
    || candidate.code === 1014;
}

function writePresets(storage: PresetStorage, presets: FilterPreset[]): void {
  try {
    storage.setItem(PRESETS_KEY, JSON.stringify(presets));
  } catch (error) {
    if (isQuotaExceeded(error)) {
      throw new Error('Could not save preset — storage full', { cause: error });
    }
    throw new Error('Could not update filter presets in localStorage', { cause: error });
  }
}

export function savePreset(preset: FilterPreset, storage?: PresetStorage): FilterPreset[] {
  if (!isFilterPreset(preset)) {
    throw new TypeError('Invalid filter preset');
  }

  const target = getStorage(storage);
  const presets = [...readPresets(target), preset];
  writePresets(target, presets);
  return presets;
}

export function deletePreset(id: string, storage?: PresetStorage): FilterPreset[] {
  const target = getStorage(storage);
  const presets = readPresets(target).filter((preset) => preset.id !== id);
  writePresets(target, presets);
  return presets;
}
