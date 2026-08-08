import { randomUUID } from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3';
import type {
  CreateSavedFolderInput,
  CreateSavedItemInput,
  DeleteSavedFolderResult,
  SavedFolder,
  SavedItem,
  SavedItemPayload,
  SavedLibrarySnapshot,
  UpdateSavedFolderInput,
  UpdateSavedItemInput,
} from '../../../shared/domain/saved.js';
import { MAX_SAVED_FOLDER_DEPTH } from '../../../shared/domain/saved.js';
import { appError } from '../../../shared/errors/index.js';

function rowToFolder(row: Record<string, unknown>): SavedFolder {
  return {
    id: row.id as string,
    name: row.name as string,
    connectionId: (row.connection_id as string) ?? null,
    parentId: (row.parent_id as string) ?? null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

function rowToItem(row: Record<string, unknown>): SavedItem {
  let payload: SavedItemPayload;
  try {
    payload = JSON.parse(row.payload_json as string) as SavedItemPayload;
  } catch {
    throw appError('LocalPersistence', 'A saved item contains invalid local data.');
  }
  const type = row.item_type as SavedItem['type'];
  if (payload.type !== type) {
    throw appError('LocalPersistence', 'A saved item type does not match its local payload.');
  }
  return {
    id: row.id as string,
    name: row.name as string,
    type,
    folderId: (row.folder_id as string) ?? null,
    connectionId: (row.connection_id as string) ?? null,
    database: (row.database_name as string) ?? null,
    collection: (row.collection_name as string) ?? null,
    tags: JSON.parse(row.tags_json as string) as string[],
    payload,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

export class SavedLibraryRepo {
  constructor(private readonly db: BetterSqlite3.Database) {}

  list(): SavedLibrarySnapshot {
    const folders = this.db.prepare(
      'SELECT * FROM saved_folders ORDER BY name COLLATE NOCASE ASC, created_at ASC',
    ).all() as Record<string, unknown>[];
    const items = this.db.prepare(
      'SELECT * FROM saved_items ORDER BY name COLLATE NOCASE ASC, created_at ASC',
    ).all() as Record<string, unknown>[];
    return { folders: folders.map(rowToFolder), items: items.map(rowToItem) };
  }

  folderById(id: string): SavedFolder | null {
    const row = this.db.prepare('SELECT * FROM saved_folders WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToFolder(row) : null;
  }

  itemById(id: string): SavedItem | null {
    const row = this.db.prepare('SELECT * FROM saved_items WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToItem(row) : null;
  }

  createFolder(input: CreateSavedFolderInput): SavedFolder {
    this.assertFolderParent(input.parentId, input.connectionId);
    this.assertAvailableName(input.name, input.connectionId, input.parentId, null);
    this.assertFolderDepth(input.parentId, 0);
    const now = Date.now();
    const folder: SavedFolder = { id: randomUUID(), ...input, createdAt: now, updatedAt: now };
    try {
      this.db.prepare(`
        INSERT INTO saved_folders (id, name, connection_id, parent_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(folder.id, folder.name, folder.connectionId, folder.parentId, now, now);
      return folder;
    } catch (error) {
      throw this.persistenceError('create saved folder', error);
    }
  }

  updateFolder(input: UpdateSavedFolderInput): SavedFolder {
    const existing = this.folderById(input.id);
    if (!existing) throw appError('NotFound', 'Saved folder not found.');
    if (input.parentId === input.id) throw appError('Validation', 'A folder cannot contain itself.');
    this.assertFolderParent(input.parentId, input.connectionId);
    this.assertAvailableName(input.name, input.connectionId, input.parentId, input.id);
    const subtreeHeight = this.subtreeHeight(input.id);
    this.assertFolderDepth(input.parentId, subtreeHeight);
    if (this.descendantFolderIds(input.id).includes(input.parentId ?? '')) {
      throw appError('Validation', 'A folder cannot be moved into one of its descendants.');
    }

    const now = Date.now();
    const update = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE saved_folders
        SET name = ?, connection_id = ?, parent_id = ?, updated_at = ?
        WHERE id = ?
      `).run(input.name, input.connectionId, input.parentId, now, input.id);
      if (existing.connectionId !== input.connectionId) {
        const ids = this.descendantFolderIds(input.id);
        const placeholders = ids.map(() => '?').join(',');
        this.db.prepare(`
          UPDATE saved_folders SET connection_id = ?, updated_at = ? WHERE id IN (${placeholders})
        `).run(input.connectionId, now, ...ids);
        this.db.prepare(`
          UPDATE saved_items SET connection_id = ?, updated_at = ? WHERE folder_id IN (${placeholders})
        `).run(input.connectionId, now, ...ids);
      }
    });
    try {
      update();
      return this.folderById(input.id)!;
    } catch (error) {
      throw this.persistenceError('update saved folder', error);
    }
  }

  deleteFolder(id: string): DeleteSavedFolderResult {
    if (!this.folderById(id)) throw appError('NotFound', 'Saved folder not found.');
    const deletedFolderIds = this.descendantFolderIds(id);
    const placeholders = deletedFolderIds.map(() => '?').join(',');
    const deletedItemIds = (this.db.prepare(
      `SELECT id FROM saved_items WHERE folder_id IN (${placeholders})`,
    ).all(...deletedFolderIds) as Array<{ id: string }>).map((row) => row.id);
    try {
      this.db.prepare('DELETE FROM saved_folders WHERE id = ?').run(id);
      return { deletedFolderIds, deletedItemIds };
    } catch (error) {
      throw this.persistenceError('delete saved folder', error);
    }
  }

  createItem(input: CreateSavedItemInput): SavedItem {
    this.assertItemInput(input);
    this.assertAvailableName(input.name, input.connectionId, input.folderId, null);
    const now = Date.now();
    const item: SavedItem = { id: randomUUID(), ...input, createdAt: now, updatedAt: now };
    try {
      this.db.prepare(`
        INSERT INTO saved_items
          (id, name, item_type, folder_id, connection_id, database_name, collection_name,
           tags_json, payload_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        item.id,
        item.name,
        item.type,
        item.folderId,
        item.connectionId,
        item.database,
        item.collection,
        JSON.stringify(item.tags),
        JSON.stringify(item.payload),
        now,
        now,
      );
      return item;
    } catch (error) {
      throw this.persistenceError('create saved item', error);
    }
  }

  updateItem(input: UpdateSavedItemInput): SavedItem {
    if (!this.itemById(input.id)) throw appError('NotFound', 'Saved item not found.');
    this.assertItemInput(input);
    this.assertAvailableName(input.name, input.connectionId, input.folderId, input.id);
    const now = Date.now();
    try {
      this.db.prepare(`
        UPDATE saved_items SET
          name = ?, item_type = ?, folder_id = ?, connection_id = ?, database_name = ?,
          collection_name = ?, tags_json = ?, payload_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        input.name,
        input.type,
        input.folderId,
        input.connectionId,
        input.database,
        input.collection,
        JSON.stringify(input.tags),
        JSON.stringify(input.payload),
        now,
        input.id,
      );
      return this.itemById(input.id)!;
    } catch (error) {
      throw this.persistenceError('update saved item', error);
    }
  }

  deleteItem(id: string): void {
    if (!this.itemById(id)) throw appError('NotFound', 'Saved item not found.');
    try {
      this.db.prepare('DELETE FROM saved_items WHERE id = ?').run(id);
    } catch (error) {
      throw this.persistenceError('delete saved item', error);
    }
  }

  renameCollectionContext(connectionId: string, database: string, oldName: string, newName: string): void {
    this.db.prepare(`
      UPDATE saved_items SET collection_name = ?, updated_at = ?
      WHERE connection_id = ? AND database_name = ? AND collection_name = ?
    `).run(newName, Date.now(), connectionId, database, oldName);
  }

  private assertItemInput(input: CreateSavedItemInput | UpdateSavedItemInput): void {
    if (input.payload.type !== input.type) {
      throw appError('Validation', 'Saved item type and payload must match.');
    }
    if (input.folderId) {
      const folder = this.folderById(input.folderId);
      if (!folder) throw appError('NotFound', 'Saved folder not found.');
      if (folder.connectionId !== input.connectionId) {
        throw appError('Validation', 'Saved item and folder must belong to the same connection.');
      }
    }
  }

  private assertFolderParent(parentId: string | null, connectionId: string | null): void {
    if (!parentId) return;
    const parent = this.folderById(parentId);
    if (!parent) throw appError('NotFound', 'Parent saved folder not found.');
    if (parent.connectionId !== connectionId) {
      throw appError('Validation', 'Saved folder and parent must belong to the same connection.');
    }
  }

  private assertAvailableName(
    name: string,
    connectionId: string | null,
    parentOrFolderId: string | null,
    excludedId: string | null,
  ): void {
    const normalized = name.toLocaleLowerCase();
    const folders = this.db.prepare(`
      SELECT id, name FROM saved_folders
      WHERE connection_id IS ? AND parent_id IS ?
    `).all(connectionId, parentOrFolderId) as Array<{ id: string; name: string }>;
    const items = this.db.prepare(`
      SELECT id, name FROM saved_items
      WHERE connection_id IS ? AND folder_id IS ?
    `).all(connectionId, parentOrFolderId) as Array<{ id: string; name: string }>;
    if ([...folders, ...items].some((entry) => (
      entry.id !== excludedId && entry.name.toLocaleLowerCase() === normalized
    ))) {
      throw appError('Validation', 'A saved folder or item with this name already exists here.');
    }
  }

  private assertFolderDepth(parentId: string | null, subtreeHeight: number): void {
    let depth = 1;
    let current = parentId;
    const visited = new Set<string>();
    while (current) {
      if (visited.has(current)) throw appError('Validation', 'Saved folder hierarchy contains a cycle.');
      visited.add(current);
      const folder = this.folderById(current);
      if (!folder) throw appError('NotFound', 'Parent saved folder not found.');
      depth += 1;
      current = folder.parentId;
    }
    if (depth + subtreeHeight > MAX_SAVED_FOLDER_DEPTH) {
      throw appError('Validation', `Saved folders support up to ${MAX_SAVED_FOLDER_DEPTH} levels.`);
    }
  }

  private descendantFolderIds(id: string): string[] {
    return (this.db.prepare(`
      WITH RECURSIVE tree(id) AS (
        SELECT id FROM saved_folders WHERE id = ?
        UNION ALL
        SELECT child.id FROM saved_folders child JOIN tree ON child.parent_id = tree.id
      )
      SELECT id FROM tree
    `).all(id) as Array<{ id: string }>).map((row) => row.id);
  }

  private subtreeHeight(id: string): number {
    const row = this.db.prepare(`
      WITH RECURSIVE tree(id, depth) AS (
        SELECT id, 0 FROM saved_folders WHERE id = ?
        UNION ALL
        SELECT child.id, tree.depth + 1
        FROM saved_folders child JOIN tree ON child.parent_id = tree.id
      )
      SELECT COALESCE(MAX(depth), 0) AS depth FROM tree
    `).get(id) as { depth: number };
    return row.depth;
  }

  private persistenceError(action: string, error: unknown) {
    if (error && typeof error === 'object' && 'category' in error) return error;
    return appError('LocalPersistence', `Failed to ${action}.`);
  }
}

