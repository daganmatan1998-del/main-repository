import { dbDelete, dbGet, dbGetAll, dbGetByIndex, dbPut, STORE_ASSETS } from './db';
import type { AssetInfo, AssetRecord, Bounds } from '../project/types';

/** In-memory copy so the library and stats don't hit IndexedDB repeatedly. */
const infoCache = new Map<string, AssetInfo>();

export function toInfo(rec: AssetRecord): AssetInfo {
  return { id: rec.id, name: rec.name, format: rec.format, size: rec.size, builtin: false, bounds: rec.bounds };
}

export async function getAsset(id: string): Promise<AssetRecord | undefined> {
  return dbGet<AssetRecord>(STORE_ASSETS, id);
}

export async function findAssetByHash(hash: string): Promise<AssetRecord | undefined> {
  return dbGetByIndex<AssetRecord>(STORE_ASSETS, 'hash', hash);
}

export async function putAsset(rec: AssetRecord): Promise<void> {
  await dbPut(STORE_ASSETS, rec);
  infoCache.set(rec.id, toInfo(rec));
}

export async function setAssetBounds(id: string, bounds: Bounds): Promise<void> {
  const rec = await getAsset(id);
  if (!rec) return;
  rec.bounds = bounds;
  await putAsset(rec);
}

export async function deleteAsset(id: string): Promise<void> {
  await dbDelete(STORE_ASSETS, id);
  infoCache.delete(id);
}

export async function listAssetInfos(): Promise<AssetInfo[]> {
  const all = await dbGetAll<AssetRecord>(STORE_ASSETS);
  infoCache.clear();
  for (const rec of all) infoCache.set(rec.id, toInfo(rec));
  return [...infoCache.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function cachedAssetInfo(id: string): AssetInfo | undefined {
  return infoCache.get(id);
}
