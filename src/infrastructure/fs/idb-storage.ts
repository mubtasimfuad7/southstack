// ============================================================
// INFRASTRUCTURE LAYER: IndexedDB persistence
// Stores file contents and directory handles in IDB
// ============================================================

import { openDB, IDBPDatabase } from 'idb'
import type { FileEntry } from './types'

const DB_NAME = 'southstack-fs'
const DB_VERSION = 1
const FILES_STORE = 'files'
const META_STORE = 'meta'

let _db: IDBPDatabase | null = null

async function getDb(): Promise<IDBPDatabase> {
  if (_db) return _db
  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(FILES_STORE)) {
        db.createObjectStore(FILES_STORE, { keyPath: 'path' })
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE)
      }
    },
  })
  return _db
}

export async function saveFile(entry: FileEntry): Promise<void> {
  const db = await getDb()
  await db.put(FILES_STORE, entry)
}

export async function loadFile(path: string): Promise<FileEntry | undefined> {
  const db = await getDb()
  return db.get(FILES_STORE, path)
}

export async function deleteFile(path: string): Promise<void> {
  const db = await getDb()
  await db.delete(FILES_STORE, path)
}

export async function listAllFiles(): Promise<FileEntry[]> {
  const db = await getDb()
  return db.getAll(FILES_STORE)
}

export async function saveMeta(key: string, value: unknown): Promise<void> {
  const db = await getDb()
  await db.put(META_STORE, value, key)
}

export async function loadMeta<T>(key: string): Promise<T | undefined> {
  const db = await getDb()
  return db.get(META_STORE, key)
}

export async function clearAllStores(): Promise<void> {
  const db = await getDb()
  const tx = db.transaction([FILES_STORE, META_STORE], 'readwrite')
  await Promise.all([
    tx.objectStore(FILES_STORE).clear(),
    tx.objectStore(META_STORE).clear(),
    tx.done
  ])
}
