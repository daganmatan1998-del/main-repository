import { dbDelete, dbGet, dbGetAll, dbGetByIndex, dbPut, STORE_PROJECTS } from './db';
import type { ProjectDoc } from '../project/types';

export async function getProject(id: string): Promise<unknown> {
  return dbGet<unknown>(STORE_PROJECTS, id);
}

export async function getProjectBySaveCode(code: string): Promise<unknown> {
  return dbGetByIndex<unknown>(STORE_PROJECTS, 'saveCode', code);
}

export async function putProject(doc: ProjectDoc): Promise<void> {
  await dbPut(STORE_PROJECTS, doc);
}

export async function deleteProjectRecord(id: string): Promise<void> {
  await dbDelete(STORE_PROJECTS, id);
}

/** Raw records — callers validate, since a corrupted record must not break the list. */
export async function listProjectRecords(): Promise<unknown[]> {
  return dbGetAll<unknown>(STORE_PROJECTS);
}
