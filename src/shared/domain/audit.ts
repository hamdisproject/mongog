export const AUDIT_CATEGORIES = [
  'connection',
  'query',
  'cursor',
  'documents',
  'schema',
  'administration',
  'change-stream',
  'gridfs',
] as const;

export const AUDIT_STATUSES = [
  'running',
  'success',
  'error',
  'cancelled',
  'interrupted',
] as const;

export const AUDIT_ORIGINS = ['user', 'background', 'system'] as const;
export const AUDIT_OPERATION_CLASSES = ['read', 'write', 'connection', 'background', 'admin'] as const;

export type AuditCategory = typeof AUDIT_CATEGORIES[number];
export type AuditStatus = typeof AUDIT_STATUSES[number];
export type AuditOrigin = typeof AUDIT_ORIGINS[number];
export type AuditOperationClass = typeof AUDIT_OPERATION_CLASSES[number];

export interface AuditLogEntry {
  id: string;
  correlationId?: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  connectionId?: string;
  connectionName: string;
  database?: string;
  collection?: string;
  category: AuditCategory;
  action: string;
  origin: AuditOrigin;
  operationClass: AuditOperationClass;
  status: AuditStatus;
  summary: string;
  detail?: Record<string, unknown>;
  errorCategory?: string;
  errorMessage?: string;
  resultCount?: number;
  affectedCount?: number;
}

export interface AuditFilter {
  text?: string;
  connectionId?: string;
  database?: string;
  collection?: string;
  category?: AuditCategory;
  action?: string;
  origin?: AuditOrigin;
  status?: AuditStatus;
  fromTs?: number;
  toTs?: number;
}

export interface AuditListPage {
  entries: AuditLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

export interface AuditSummary {
  total: number;
  reads: number;
  writes: number;
  connections: number;
  errors: number;
  averageDurationMs: number;
  byCategory: Array<{ key: string; count: number }>;
  byConnection: Array<{ connectionId?: string; connectionName: string; count: number }>;
  timeline: Array<{ bucketStart: number; count: number; errors: number }>;
  health: { healthy: boolean; message?: string };
}

export type AuditBucket = 'hour' | 'day';

export interface AuditChangedEvent {
  kind: 'created' | 'updated' | 'deleted' | 'cleared' | 'health';
  entryId?: string;
}
