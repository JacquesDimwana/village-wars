import type { GameState } from './types';

/** Bump when GameState changes shape in a way old saves can't be loaded into. */
const SAVE_VERSION = 3;
export const SAVE_KEY = 'village-wars:save';

/** Subset of the Web Storage API, so tests can pass an in-memory store. */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface SaveFile {
  version: number;
  savedAt: number;
  state: GameState;
}

const U8_TAG = '__u8';

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

/** JSON with typed arrays (fog bitmaps) encoded as base64. */
export function serialize(state: GameState, savedAt = Date.now()): string {
  const file: SaveFile = { version: SAVE_VERSION, savedAt, state };
  return JSON.stringify(file, (_key, value: unknown) =>
    value instanceof Uint8Array ? { [U8_TAG]: toBase64(value) } : value,
  );
}

/** Returns null for anything that isn't a compatible save. */
export function deserialize(json: string, expectedSeed?: number): GameState | null {
  try {
    const file = JSON.parse(json, (_key, value: unknown) => {
      if (value && typeof value === 'object' && U8_TAG in value) {
        return fromBase64((value as Record<string, string>)[U8_TAG]);
      }
      return value;
    }) as SaveFile;
    if (file?.version !== SAVE_VERSION || !file.state?.villages || !file.state.villagers || !file.state.foodSources || !file.state.stats) return null;
    if (expectedSeed !== undefined && file.state.seed !== expectedSeed) return null;
    return file.state;
  } catch {
    return null;
  }
}

/** Default store; null when storage is blocked (private mode, sandboxed WebView…). */
export function localStore(): KeyValueStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function saveGame(state: GameState, store: KeyValueStore | null = localStore()): boolean {
  if (!store) return false;
  try {
    store.setItem(SAVE_KEY, serialize(state));
    return true;
  } catch {
    return false; // quota exceeded or storage disabled
  }
}

export function loadGame(expectedSeed?: number, store: KeyValueStore | null = localStore()): GameState | null {
  try {
    const json = store?.getItem(SAVE_KEY);
    return json ? deserialize(json, expectedSeed) : null;
  } catch {
    return null;
  }
}

export function clearSave(store: KeyValueStore | null = localStore()): void {
  try {
    store?.removeItem(SAVE_KEY);
  } catch {
    // ignore
  }
}

/** Small persistent flags (tutorial seen…). Never throws. */
export function getFlag(name: string, store: KeyValueStore | null = localStore()): boolean {
  try {
    return store?.getItem(`village-wars:${name}`) === '1';
  } catch {
    return false;
  }
}

export function setFlag(name: string, store: KeyValueStore | null = localStore()): void {
  try {
    store?.setItem(`village-wars:${name}`, '1');
  } catch {
    // ignore
  }
}
