import type { SchemaFieldInfo } from '../../shared/domain/index.js';
import type { CompletionContext } from './context.js';

export type SemanticSuggestionKind =
  | 'collection'
  | 'database'
  | 'field'
  | 'field-reference'
  | 'operator'
  | 'stage';

export interface SemanticSuggestion {
  label: string;
  insertText: string;
  kind: SemanticSuggestionKind;
  detail: string;
  documentation?: string;
  sortText?: string;
  snippet?: boolean;
}

export interface SemanticCompletionData {
  databaseNames?: string[];
  collectionNames?: string[];
  fields?: SchemaFieldInfo[];
}

const ROOT_FILTER_OPERATORS = [
  ['$and', '$and: [${1}]', 'logical AND'],
  ['$or', '$or: [${1}]', 'logical OR'],
  ['$nor', '$nor: [${1}]', 'logical NOR'],
  ['$expr', '$expr: ${1}', 'aggregation expression'],
  ['$text', '$text: { ${1} }', 'text search'],
  ['$where', '$where: ${1}', 'JavaScript predicate'],
  ['$comment', '$comment: "${1}"', 'query comment'],
] as const;

const FIELD_FILTER_OPERATORS = [
  ['$eq', '$eq: ${1}', 'equal'],
  ['$ne', '$ne: ${1}', 'not equal'],
  ['$gt', '$gt: ${1}', 'greater than'],
  ['$gte', '$gte: ${1}', 'greater than or equal'],
  ['$lt', '$lt: ${1}', 'less than'],
  ['$lte', '$lte: ${1}', 'less than or equal'],
  ['$in', '$in: [${1}]', 'matches a value in an array'],
  ['$nin', '$nin: [${1}]', 'matches no value in an array'],
  ['$exists', '$exists: ${1:true}', 'field existence'],
  ['$type', '$type: "${1:string}"', 'BSON type'],
  ['$regex', '$regex: "${1}"', 'regular expression'],
  ['$all', '$all: [${1}]', 'array contains all values'],
  ['$elemMatch', '$elemMatch: { ${1} }', 'array element match'],
  ['$size', '$size: ${1:0}', 'array length'],
  ['$not', '$not: { ${1} }', 'negates a field expression'],
] as const;

const UPDATE_OPERATORS = [
  ['$set', '$set: { ${1} }', 'set field values'],
  ['$unset', '$unset: { ${1} }', 'remove fields'],
  ['$inc', '$inc: { ${1} }', 'increment numeric fields'],
  ['$mul', '$mul: { ${1} }', 'multiply numeric fields'],
  ['$min', '$min: { ${1} }', 'keep the lower value'],
  ['$max', '$max: { ${1} }', 'keep the higher value'],
  ['$rename', '$rename: { ${1} }', 'rename fields'],
  ['$currentDate', '$currentDate: { ${1} }', 'set current date'],
  ['$addToSet', '$addToSet: { ${1} }', 'add unique array values'],
  ['$push', '$push: { ${1} }', 'append array values'],
  ['$pop', '$pop: { ${1} }', 'remove first or last array item'],
  ['$pull', '$pull: { ${1} }', 'remove matching array values'],
  ['$pullAll', '$pullAll: { ${1} }', 'remove array values'],
  ['$setOnInsert', '$setOnInsert: { ${1} }', 'set values only on upsert insert'],
] as const;

const AGGREGATION_STAGES = [
  ['$match', '$match: { ${1} }', 'filter documents'],
  ['$project', '$project: { ${1} }', 'reshape documents'],
  ['$set', '$set: { ${1} }', 'add or replace fields'],
  ['$unset', '$unset: ${1}', 'remove fields'],
  ['$group', '$group: { _id: ${1} }', 'group documents'],
  ['$sort', '$sort: { ${1} }', 'sort documents'],
  ['$limit', '$limit: ${1:10}', 'limit document count'],
  ['$skip', '$skip: ${1:0}', 'skip documents'],
  ['$unwind', '$unwind: ${1}', 'deconstruct an array'],
  ['$lookup', '$lookup: { ${1} }', 'join another collection'],
  ['$count', '$count: "${1:count}"', 'count output documents'],
  ['$facet', '$facet: { ${1} }', 'run multiple pipelines'],
  ['$bucket', '$bucket: { ${1} }', 'bucket by boundaries'],
  ['$bucketAuto', '$bucketAuto: { ${1} }', 'automatically bucket values'],
  ['$replaceRoot', '$replaceRoot: { newRoot: ${1} }', 'replace root document'],
  ['$replaceWith', '$replaceWith: ${1}', 'replace root document'],
  ['$sample', '$sample: { size: ${1:10} }', 'randomly sample documents'],
  ['$sortByCount', '$sortByCount: ${1}', 'group and count values'],
  ['$unionWith', '$unionWith: { ${1} }', 'combine collection results'],
  ['$setWindowFields', '$setWindowFields: { ${1} }', 'windowed calculations'],
  ['$densify', '$densify: { ${1} }', 'fill sequence gaps'],
  ['$fill', '$fill: { ${1} }', 'fill missing values'],
  ['$geoNear', '$geoNear: { ${1} }', 'geospatial proximity stage'],
  ['$out', '$out: "${1:collection}"', 'write results to a collection'],
  ['$merge', '$merge: { into: "${1:collection}" }', 'merge results into a collection'],
] as const;

export function buildSemanticSuggestions(
  context: CompletionContext,
  data: SemanticCompletionData,
): SemanticSuggestion[] {
  switch (context.kind) {
    case 'database-name':
      return uniqueNames(data.databaseNames).map((name) => ({
        label: name,
        insertText: name,
        kind: 'database',
        detail: 'database',
      }));
    case 'collection-name':
      return uniqueNames(data.collectionNames).map((name) => ({
        label: name,
        insertText: name,
        kind: 'collection',
        detail: 'collection',
      }));
    case 'document-key':
      if (!supportsSchemaFields(context.docKind)) return [];
      return fieldSuggestions(data.fields ?? [], context.pathPrefix);
    case 'field-reference':
      return fieldReferenceSuggestions(data.fields ?? []);
    case 'operator':
      return operatorSuggestions(
        context.operatorScope === 'update'
          ? UPDATE_OPERATORS
          : context.operatorScope === 'field'
            ? FIELD_FILTER_OPERATORS
            : ROOT_FILTER_OPERATORS,
      );
    case 'aggregation-stage':
      return operatorSuggestions(AGGREGATION_STAGES, 'stage');
    case 'identifier':
      return [];
  }
}

export function contextNeedsSchema(context: CompletionContext): context is (
  | Extract<CompletionContext, { kind: 'document-key' }>
  | Extract<CompletionContext, { kind: 'field-reference' }>
) & { collection: string } {
  return typeof ('collection' in context ? context.collection : undefined) === 'string' && (
    context.kind === 'field-reference' ||
    (context.kind === 'document-key' && supportsSchemaFields(context.docKind))
  );
}

function supportsSchemaFields(docKind: Extract<CompletionContext, { kind: 'document-key' }>['docKind']): boolean {
  return docKind === 'filter' ||
    docKind === 'update' ||
    docKind === 'projection' ||
    docKind === 'sort' ||
    docKind === 'document';
}

function fieldSuggestions(fields: SchemaFieldInfo[], pathPrefix?: string): SemanticSuggestion[] {
  const suggestions = new Map<string, SemanticSuggestion>();
  for (const field of fields) {
    const relativePath = relativeFieldPath(field.path, pathPrefix);
    if (!relativePath) continue;
    const primaryType = field.types[0]?.bsonType ?? 'unknown';
    const typeSummary = field.types.slice(0, 3).map((type) => type.bsonType).join(' | ');
    const suggestion: SemanticSuggestion = {
      label: relativePath,
      insertText: relativePath,
      kind: 'field',
      detail: `${typeSummary || primaryType} · ${(field.presence * 100).toFixed(0)}% sampled`,
      documentation: field.exampleEjson
        ? `Inferred from ${field.path}. Example: ${field.exampleEjson}`
        : `Inferred from sampled field ${field.path}.`,
      sortText: `a${Math.round((1 - field.presence) * 1000).toString().padStart(4, '0')}-${relativePath}`,
    };
    if (!suggestions.has(relativePath)) suggestions.set(relativePath, suggestion);
  }
  return [...suggestions.values()].sort((left, right) =>
    (left.sortText ?? left.label).localeCompare(right.sortText ?? right.label),
  );
}

function fieldReferenceSuggestions(fields: SchemaFieldInfo[]): SemanticSuggestion[] {
  return fields.map((field) => ({
    label: `$${field.path}`,
    insertText: field.path,
    kind: 'field-reference',
    detail: `${field.types.slice(0, 3).map((type) => type.bsonType).join(' | ')} · field reference`,
    documentation: `Inferred from sampled field ${field.path}.`,
    sortText: `a${Math.round((1 - field.presence) * 1000).toString().padStart(4, '0')}-${field.path}`,
  }));
}

function relativeFieldPath(path: string, prefix?: string): string | null {
  if (!prefix) return path;
  for (const candidate of [`${prefix}.`, `${prefix}[].`]) {
    if (path.startsWith(candidate)) {
      const relative = path.slice(candidate.length);
      // Nested object paths are already present as their own sampled field;
      // show only the immediate level in an explicitly nested object literal.
      return relative.includes('.') ? relative.slice(0, relative.indexOf('.')) : relative;
    }
  }
  return null;
}

function operatorSuggestions(
  definitions: ReadonlyArray<readonly [string, string, string]>,
  kind: 'operator' | 'stage' = 'operator',
): SemanticSuggestion[] {
  return definitions.map(([label, insertText, detail], index) => ({
    label,
    insertText,
    kind,
    detail,
    snippet: true,
    sortText: `${index.toString().padStart(3, '0')}-${label}`,
  }));
}

function uniqueNames(names: string[] | undefined): string[] {
  return [...new Set(names ?? [])].sort((left, right) => left.localeCompare(right));
}
