import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import path from "node:path";
import fs from "node:fs";

/* -------------------------------------------------------------------------- */
/*  Shared interface for both better-sqlite3 and sql.js compat wrappers       */
/* -------------------------------------------------------------------------- */

export interface StmtLike {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number };
}

export interface DbLike {
  prepare(sql: string): StmtLike;
  exec(sql: string): void;
  close(): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transaction(fn: (...args: any[]) => any): (...args: any[]) => any;
}

/* -------------------------------------------------------------------------- */
/*  Compatibility layer: makes sql.js look like better-sqlite3                */
/* -------------------------------------------------------------------------- */

class CompatStatement {
  constructor(private sqlDb: SqlJsDatabase, private sql: string) {}

  get(...params: unknown[]): Record<string, unknown> | undefined {
    const stmt = this.sqlDb.prepare(this.sql);
    try {
      if (params.length) stmt.bind(params as (string | number | null | Uint8Array)[]);
      return stmt.step() ? stmt.getAsObject() : undefined;
    } finally {
      stmt.free();
    }
  }

  all(...params: unknown[]): Record<string, unknown>[] {
    const stmt = this.sqlDb.prepare(this.sql);
    try {
      if (params.length) stmt.bind(params as (string | number | null | Uint8Array)[]);
      const rows: Record<string, unknown>[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  run(...params: unknown[]): { changes: number } {
    const stmt = this.sqlDb.prepare(this.sql);
    try {
      if (params.length) stmt.bind(params as (string | number | null | Uint8Array)[]);
      stmt.step();
    } finally {
      stmt.free();
    }
    return { changes: this.sqlDb.getRowsModified() };
  }
}

export class CompatDb {
  constructor(private sqlDb: SqlJsDatabase) {}
  prepare(sql: string): CompatStatement {
    return new CompatStatement(this.sqlDb, sql);
  }
  pragma(_stmt: string): unknown { return null; }
  exec(sql: string): void { this.sqlDb.run(sql); }
  close(): void { this.sqlDb.close(); }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transaction(fn: (...args: any[]) => any): (...args: any[]) => any {
    return ((...args: unknown[]) => {
      this.sqlDb.run("BEGIN TRANSACTION");
      try {
        const result = fn(...args);
        this.sqlDb.run("COMMIT");
        return result;
      } catch (e) {
        this.sqlDb.run("ROLLBACK");
        throw e;
      }
    }) as (...args: unknown[]) => unknown;
  }
}

/* -------------------------------------------------------------------------- */
/*  Initialization                                                            */
/* -------------------------------------------------------------------------- */

function resolveDbPath(): string {
  const candidates = [
    path.join(process.cwd(), "data", "forecast.db"),
    path.resolve(__dirname, "..", "..", "..", "..", "data", "forecast.db"),
    path.resolve(__dirname, "..", "..", "data", "forecast.db"),
    path.resolve(__dirname, "..", "data", "forecast.db"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error(
    `forecast.db not found. cwd=${process.cwd()}, __dirname=${__dirname}, tried: ${candidates.join(", ")}`,
  );
}

const g = globalThis as unknown as { __fcDb?: CompatDb; __fcDbPromise?: Promise<void> };

export async function ensureDb(): Promise<void> {
  if (g.__fcDb) return;
  if (g.__fcDbPromise) return g.__fcDbPromise;
  g.__fcDbPromise = (async () => {
    const SQL = await initSqlJs();
    const dbPath = resolveDbPath();
    const buffer = fs.readFileSync(dbPath);
    g.__fcDb = new CompatDb(new SQL.Database(buffer));
  })();
  return g.__fcDbPromise;
}

export function getDb(): CompatDb {
  if (!g.__fcDb) throw new Error("DB not initialised – call ensureDb() first");
  return g.__fcDb;
}

export function getWritableDb(): CompatDb {
  throw new Error("Writable DB not available in serverless mode");
}

export async function withDb<T>(fn: () => T | Promise<T>): Promise<T> {
  await ensureDb();
  return fn();
}
