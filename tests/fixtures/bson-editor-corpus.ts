import {
  Binary,
  BSONRegExp,
  BSONSymbol,
  Code,
  DBRef,
  Decimal128,
  Double,
  Int32,
  Long,
  MaxKey,
  MinKey,
  ObjectId,
  Timestamp,
  UUID,
} from 'bson';

export interface EditorBsonCase {
  name: string;
  field: string;
  source: string;
  expected: unknown;
}

const oid = (hex: string) => new ObjectId(hex);

/** Every BSON value syntax intentionally exposed by the document editor. */
export const editorBsonCases: readonly EditorBsonCase[] = [
  { name: 'ObjectId', field: 'objectIdValue', source: 'ObjectId("64b64c000000000000000001")', expected: oid('64b64c000000000000000001') },
  { name: 'string', field: 'stringValue', source: '"hello"', expected: 'hello' },
  { name: 'ObjectId-looking string', field: 'objectIdString', source: '"ObjectId(\\"64b64c000000000000000001\\")"', expected: 'ObjectId("64b64c000000000000000001")' },
  { name: 'boolean', field: 'booleanValue', source: 'true', expected: true },
  { name: 'null', field: 'nullValue', source: 'null', expected: null },
  { name: 'object', field: 'objectValue', source: '{ count: Int32(2), child: { active: true } }', expected: { count: new Int32(2), child: { active: true } } },
  { name: 'array', field: 'arrayValue', source: '[Int32(1), "two", { oid: ObjectId("64b64c000000000000000002") }]', expected: [new Int32(1), 'two', { oid: oid('64b64c000000000000000002') }] },
  { name: 'bare integer', field: 'bareInteger', source: '42', expected: new Int32(42) },
  { name: 'Int32', field: 'int32Value', source: 'Int32(-42)', expected: new Int32(-42) },
  { name: 'NumberInt alias', field: 'numberIntValue', source: 'NumberInt(43)', expected: new Int32(43) },
  { name: 'Long', field: 'longValue', source: 'Long("9223372036854775807")', expected: Long.fromString('9223372036854775807') },
  { name: 'NumberLong alias', field: 'numberLongValue', source: 'NumberLong("-9223372036854775808")', expected: Long.fromString('-9223372036854775808') },
  { name: 'bare decimal', field: 'bareDecimal', source: '42.5', expected: new Double(42.5) },
  { name: 'Double', field: 'doubleValue', source: 'Double(3.14159)', expected: new Double(3.14159) },
  { name: 'Double NaN', field: 'doubleNaN', source: 'Double("NaN")', expected: new Double(Number.NaN) },
  { name: 'Double positive infinity', field: 'doublePositiveInfinity', source: 'Double("Infinity")', expected: new Double(Number.POSITIVE_INFINITY) },
  { name: 'Double negative infinity', field: 'doubleNegativeInfinity', source: 'Double("-Infinity")', expected: new Double(Number.NEGATIVE_INFINITY) },
  { name: 'Double negative zero', field: 'doubleNegativeZero', source: 'Double(-0)', expected: new Double(-0) },
  { name: 'Decimal128', field: 'decimalValue', source: 'Decimal128("1234.5678")', expected: Decimal128.fromString('1234.5678') },
  { name: 'NumberDecimal alias', field: 'numberDecimalValue', source: 'NumberDecimal("-0.001")', expected: Decimal128.fromString('-0.001') },
  { name: 'ISODate', field: 'isoDateValue', source: 'ISODate("2026-01-02T03:04:05.006Z")', expected: new Date('2026-01-02T03:04:05.006Z') },
  { name: 'new Date', field: 'newDateValue', source: 'new Date("1960-01-02T03:04:05.006Z")', expected: new Date('1960-01-02T03:04:05.006Z') },
  { name: 'BinData generic', field: 'binaryValue', source: 'BinData(0, "AQIDBA==")', expected: new Binary(Buffer.from([1, 2, 3, 4]), 0) },
  { name: 'BinData user-defined', field: 'userBinaryValue', source: 'BinData(128, "qrvM")', expected: new Binary(Buffer.from([0xaa, 0xbb, 0xcc]), 128) },
  { name: 'UUID', field: 'uuidValue', source: 'UUID("123e4567-e89b-12d3-a456-426614174000")', expected: new UUID('123e4567-e89b-12d3-a456-426614174000') },
  { name: 'regex literal', field: 'regexLiteralValue', source: '/^ab+c$/im', expected: new BSONRegExp('^ab+c$', 'im') },
  { name: 'BSONRegExp', field: 'bsonRegexValue', source: 'BSONRegExp("^bike", "i")', expected: new BSONRegExp('^bike', 'i') },
  { name: 'Timestamp', field: 'timestampValue', source: 'Timestamp({ t: 1700000000, i: 4 })', expected: new Timestamp({ t: 1700000000, i: 4 }) },
  { name: 'MinKey', field: 'minKeyValue', source: 'MinKey()', expected: new MinKey() },
  { name: 'MaxKey', field: 'maxKeyValue', source: 'MaxKey()', expected: new MaxKey() },
  { name: 'DBRef', field: 'dbRefValue', source: 'DBRef("related", ObjectId("64b64c000000000000000003"), "archive", { region: "eu" })', expected: new DBRef('related', oid('64b64c000000000000000003'), 'archive', { region: 'eu' }) },
  { name: 'Code', field: 'codeValue', source: 'Code("return 1;")', expected: new Code('return 1;') },
  { name: 'Code with scope', field: 'scopedCodeValue', source: 'Code("return value;", { value: Int32(7) })', expected: new Code('return value;', { value: new Int32(7) }) },
  { name: 'BSONSymbol', field: 'symbolValue', source: 'BSONSymbol("legacy")', expected: new BSONSymbol('legacy') },
];

export function allEditorBsonDocumentSource(id: string, extraFields = ''): string {
  const fields = editorBsonCases.map(({ field, source }) => `  ${field}: ${source},`);
  if (extraFields) fields.push(`  ${extraFields},`);
  return `{\n  _id: ObjectId("${id}"),\n${fields.join('\n')}\n}`;
}
