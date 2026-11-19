import type { SaveStorage } from 'esengine';
import { createSlot } from '../../framework/storage/slot';

export interface Preferences { volume: number; language: 'zh' | 'en'; largeText: boolean; }
export const defaults: Readonly<Preferences> = { volume: 0.8, language: 'zh', largeText: false };

function validVolume(raw: unknown): raw is number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1;
}

function decode(value: unknown): Preferences {
  const data = value as Partial<Preferences> | null;
  if (!data || !validVolume(data.volume) || !['zh', 'en'].includes(data.language ?? '') ||
      typeof data.largeText !== 'boolean') throw new Error('Invalid settings data');
  return { volume: data.volume, language: data.language!, largeText: data.largeText };
}

export function openPreferences(gameId: string, storage?: SaveStorage) {
  return createSlot<Preferences>({
    gameId, slot: 'device.settings', version: 2, defaults, decode, storage,
    migrations: {
      1: old => {
        const volume = (old as { volume?: unknown } | null)?.volume;
        if (!validVolume(volume)) throw new Error('Invalid version 1 volume');
        return { ...defaults, volume };
      },
    },
  });
}
