declare module "sql.js" {
  interface Database {
    prepare(sql: string): Statement;
    run(sql: string, params?: unknown[]): Database;
    exec(sql: string): QueryExecResult[];
    getRowsModified(): number;
    close(): void;
  }

  interface Statement {
    bind(params?: (string | number | null | Uint8Array)[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, number | string | Uint8Array | null>;
    free(): boolean;
    reset(): void;
  }

  interface QueryExecResult {
    columns: string[];
    values: unknown[][];
  }

  interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }

  export type { Database, Statement, SqlJsStatic };
  export default function initSqlJs(): Promise<SqlJsStatic>;
}
