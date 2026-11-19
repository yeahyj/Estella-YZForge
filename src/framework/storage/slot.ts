import { SaveManager, type SaveMigration, type SaveStorage } from 'esengine';

export function createSlot<T>(options: {
  gameId: string;
  slot: string;
  version: number;
  defaults: T;
  decode: (value: unknown) => T;
  migrations?: Record<number, SaveMigration>;
  storage?: SaveStorage;
}) {
  const { gameId, slot, defaults, decode } = options;
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(gameId)) throw new Error('Invalid game ID: ' + gameId);
  const store = new SaveManager({ ...options, keyPrefix: gameId + ':' });
  let value = defaults;
  let readError: Error | undefined;
  function read(): T {
    if (!store.has(slot)) return defaults;
    const saved = store.load<unknown>(slot);
    if (saved === null) throw new Error('Unreadable save slot: ' + slot);
    return decode(saved);
  }
  try {
    value = read();
  } catch (error) {
    readError = error instanceof Error ? error : new Error(String(error));
  }
  let writes = Promise.resolve();
  return {
    get value() { return value; },
    get readError() { return readError; },
    update(change: (previous: Readonly<T>) => T): Promise<void> {
      const commit = writes.then(async () => {
        if (readError) throw readError;
        const next = decode(change(value));
        try {
          await store.saveAsync(slot, next);
        } catch (error) {
          // A host may have written locally before its asynchronous acknowledgment failed.
          try { value = read(); } catch (cause) { readError = new Error(String(cause)); }
          throw error;
        }
        value = next;
      });
      writes = commit.catch(() => {});
      return commit;
    },
  };
}
