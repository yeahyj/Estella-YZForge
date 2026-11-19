import type { AssetsData } from 'esengine';

/** Hold the receipt for the exact manifest revision used to load the group. */
export async function acquireGroup(assets: AssetsData, name: string, progress: (loaded: number, total: number) => void) {
  const manifest = assets.getManifest();
  if (!manifest?.assetsInGroup(name).length) throw new Error('Missing or empty asset group: ' + name);
  return assets.loadGroup(name, progress);
}

/** Release the engine's cached preparation error so an explicit retry can reach the host. */
export async function loadRequired<T>(assets: AssetsData, ref: string, load: () => Promise<T>): Promise<T> {
  try { return await load(); }
  catch (error) {
    assets.invalidate(ref);
    throw error;
  }
}
