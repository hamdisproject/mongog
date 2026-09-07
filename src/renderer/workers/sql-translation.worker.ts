/// <reference lib="webworker" />

import { SqlTranslateError, translateSql, type SqlTranslation } from '../../features/sql-translator/index.js';

type Request = { id: number; source: string };
type Response =
  | { id: number; ok: true; value: SqlTranslation }
  | {
      id: number;
      ok: false;
      message: string;
      hint: string;
      range?: { startLine: number; startCol: number; endLine: number; endCol: number };
    };

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, source } = event.data;
  let response: Response;
  try {
    response = { id, ok: true, value: translateSql(source) };
  } catch (error) {
    if (error instanceof SqlTranslateError) {
      response = {
        id,
        ok: false,
        message: error.message,
        hint: error.hint,
        ...(error.range ? { range: error.range } : {}),
      };
    } else {
      response = {
        id,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        hint: 'Fix the SQL syntax and try again.',
      };
    }
  }
  self.postMessage(response);
};

export {};
