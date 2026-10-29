/**
 * The database handle, with two drivers behind one interface.
 *
 *   sqlite  better-sqlite3 on a file (data/forecast.db). The default locally:
 *           writes persist, the forecast reads a WAL snapshot.
 *   sqljs   sql.js in memory. Used on Vercel, where the project folder is
 *           read-only and there is no native build. The database starts from
 *           the file if one is present, otherwise empty with the schema, and
 *           lives as long as the function instance: an import works for that
 *           session and is gone after a cold start. Persisting the bytes to a
 *           store (Vercel Blob, or a hosted SQLite such as Turso) is the next
 *           step for real data.
 *
 * Every caller goes through `withDb` (or awaits `ensureDb`) once per request;
 * after that reads and writes are synchronous on both drivers.
 */

import fs from "node:fs";
import path from "node:path";
import type { Database as SqlJsDatabase } from "sql.js";
import { ensureSchema } from "./migrate";

export interface StmtLike {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): { changes: number };
}

export interface DbLike {
  prepare(sql: string): StmtLike;
  exec(sql: string): void;
  close(): void;
  pragma(stmt: string): unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transaction(fn: (...args: any[]) => any): (...args: any[]) => any;
}

export type Driver = "sqlite" | "sqljs";

export const DRIVER: Driver =
  process.env.DB_DRIVER === "sqljs" || (process.env.VERCEL && process.env.DB_DRIVER !== "sqlite")
    ? "sqljs"
    : "sqlite";

export const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "data", "forecast.db");

/* -------------------------------------------------------------------------- */
/* sql.js made to look like better-sqlite3                                    */
/* -------------------------------------------------------------------------- */

class CompatStatement implements StmtLike {
  constructor(
    private sqlDb: SqlJsDatabase,
    private sql: string,
  ) {}

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

export class CompatDb implements DbLike {
  constructor(private sqlDb: SqlJsDatabase) {}
  prepare(sql: string): CompatStatement {
    return new CompatStatement(this.sqlDb, sql);
  }
  pragma(): unknown {
    return null;
  }
  exec(sql: string): void {
    this.sqlDb.run(sql);
  }
  /** The in-memory database is shared by every caller; nobody closes it. */
  close(): void {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transaction(fn: (...args: any[]) => any): (...args: any[]) => any {
    return (...args: unknown[]) => {
      this.sqlDb.run("BEGIN TRANSACTION");
      try {
        const result = fn(...args);
        this.sqlDb.run("COMMIT");
        return result;
      } catch (e) {
        this.sqlDb.run("ROLLBACK");
        throw e;
      }
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Initialisation                                                             */
/* -------------------------------------------------------------------------- */

type SqliteCtor = new (
  file: string,
  options?: { readonly?: boolean },
) => DbLike & { pragma(stmt: string): unknown };

const g = globalThis as unknown as {
  __fcDb?: DbLike;
  __fcInit?: Promise<void>;
  __fcSqlite?: SqliteCtor;
};

async function initSqlite() {
  const mod = await import("better-sqlite3");
  const Database = mod.default as unknown as SqliteCtor;
  g.__fcSqlite = Database;
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const fresh = new Database(DB_PATH);
    fresh.pragma("journal_mode = WAL");
    ensureSchema(fresh);
    fresh.close();
  }
  const db = new Database(DB_PATH, { readonly: true });
  db.pragma("journal_mode = WAL");
  g.__fcDb = db;
}

async function initSqlJs() {
  const mod = await import("sql.js");
  const SQL = await mod.default();
  const seed = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : null;
  const db = new CompatDb(new SQL.Database(seed));
  ensureSchema(db);
  g.__fcDb = db;
}

/** Open the database once per process. Safe to call on every request. */
export function ensureDb(): Promise<void> {
  if (g.__fcDb) return Promise.resolve();
  if (!g.__fcInit) {
    g.__fcInit = (DRIVER === "sqljs" ? initSqlJs() : initSqlite()).catch((err) => {
      g.__fcInit = undefined;
      throw err;
    });
  }
  return g.__fcInit;
}

/** The read handle. Call after `ensureDb()` or inside `withDb`. */
export function getDb(): DbLike {
  if (!g.__fcDb) throw new Error("Database not initialised: wrap the call in withDb()");
  return g.__fcDb;
}

/**
 * A handle for writing. On sqlite it is a fresh connection that the caller
 * closes; on sql.js it is the shared in-memory database (close is a no-op).
 */
export function getWritableDb(): DbLike {
  if (DRIVER === "sqljs") return getDb();
  if (!g.__fcSqlite) throw new Error("Database not initialised: wrap the call in withDb()");
  return new g.__fcSqlite(DB_PATH);
}

export async function withDb<T>(fn: () => T | Promise<T>): Promise<T> {
  await ensureDb();
  return fn();
}
