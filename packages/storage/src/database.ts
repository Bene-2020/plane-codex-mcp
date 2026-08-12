import { DatabaseSync } from "node:sqlite";

type Transaction<T> = (() => T) & { immediate: () => T };
type NativeStatement = ReturnType<DatabaseSync["prepare"]>;

export interface SqliteRunResult {
  changes: number;
  lastInsertRowid: number;
}

class SqliteStatement {
  constructor(private readonly statement: NativeStatement) {}

  all(...values: unknown[]): unknown[] {
    return this.statement.all(...(values as never[]));
  }

  get(...values: unknown[]): unknown {
    return this.statement.get(...(values as never[]));
  }

  run(...values: unknown[]): SqliteRunResult {
    const result = this.statement.run(...(values as never[]));
    return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) };
  }
}

/**
 * The plugin runtime uses the Node sidecar's built-in SQLite implementation.
 * Keeping this small adapter here preserves the synchronous storage API while
 * development and packaged runs use the same database engine.
 */
export class SqliteDatabase {
  private readonly database: DatabaseSync;

  constructor(filename: string) {
    this.database = new DatabaseSync(filename);
  }

  prepare(sql: string): SqliteStatement {
    return new SqliteStatement(this.database.prepare(sql));
  }

  exec(sql: string): void {
    this.database.exec(sql);
  }

  pragma(statement: string): void {
    this.database.exec(`PRAGMA ${statement}`);
  }

  transaction<T>(callback: () => T): Transaction<T> {
    const run = (begin: "BEGIN" | "BEGIN IMMEDIATE"): T => {
      this.database.exec(begin);
      try {
        const result = callback();
        this.database.exec("COMMIT");
        return result;
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
    };
    const transaction = (() => run("BEGIN")) as Transaction<T>;
    transaction.immediate = () => run("BEGIN IMMEDIATE");
    return transaction;
  }

  close(): void {
    this.database.close();
  }
}
