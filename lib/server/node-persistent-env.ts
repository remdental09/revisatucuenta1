type NodeSqliteModule = {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): {
      all(...values: unknown[]): Array<Record<string, unknown>>;
      get(...values: unknown[]): Record<string, unknown> | undefined;
      run(...values: unknown[]): { changes?: number | bigint; lastInsertRowid?: number | bigint };
    };
  };
};

type FileSystemModule = {
  mkdir(path: string, options: { recursive: boolean }): Promise<void>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  unlink(path: string): Promise<void>;
};

type PathModule = {
  resolve(...paths: string[]): string;
  join(...paths: string[]): string;
  dirname(path: string): string;
  sep: string;
};

type PersistentHost = {
  __revisaPersistentEnvironments?: Map<string, Promise<any>>;
};

const runtimeHost = (typeof process !== "undefined" ? process : globalThis) as unknown as PersistentHost;

function runtimeEnv(name: string) {
  if (typeof process === "undefined") return undefined;
  return process.env[name]?.trim() || undefined;
}

async function dynamicNodeImport<T>(specifier: string): Promise<T> {
  return import(/* @vite-ignore */ specifier) as Promise<T>;
}

class NodePreparedStatement {
  private database: InstanceType<NodeSqliteModule["DatabaseSync"]>;
  private sql: string;
  private values: unknown[];

  constructor(database: InstanceType<NodeSqliteModule["DatabaseSync"]>, sql: string, values: unknown[] = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }

  bind(...values: unknown[]) {
    return new NodePreparedStatement(this.database, this.sql, values);
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) ?? null;
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { meta: { changes: Number(result.changes || 0), last_row_id: Number(result.lastInsertRowid || 0) } };
  }
}

class NodeD1Database {
  private database: InstanceType<NodeSqliteModule["DatabaseSync"]>;

  constructor(database: InstanceType<NodeSqliteModule["DatabaseSync"]>) {
    this.database = database;
  }

  prepare(sql: string) {
    return new NodePreparedStatement(this.database, sql);
  }

  async batch(statements: NodePreparedStatement[]) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

async function encryptionKey() {
  const configured = runtimeEnv("REVISA_DOCUMENT_ENCRYPTION_KEY");
  if (!configured) throw new Error("Falta configurar el cifrado temporal de documentos");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(configured));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

class EncryptedFileBucket {
  private root: string;
  private fs: FileSystemModule;
  private path: PathModule;

  constructor(root: string, fs: FileSystemModule, path: PathModule) {
    this.root = root;
    this.fs = fs;
    this.path = path;
  }

  private target(key: string) {
    const target = this.path.resolve(this.root, key.replaceAll("/", this.path.sep));
    const prefix = `${this.path.resolve(this.root)}${this.path.sep}`;
    if (!target.startsWith(prefix)) throw new Error("Ruta de documento inválida");
    return target;
  }

  async put(key: string, value: BodyInit) {
    const bytes = new Uint8Array(await new Response(value).arrayBuffer());
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), bytes));
    const payload = new Uint8Array(iv.length + encrypted.length);
    payload.set(iv);
    payload.set(encrypted, iv.length);
    const target = this.target(key);
    await this.fs.mkdir(this.path.dirname(target), { recursive: true });
    await this.fs.writeFile(target, payload);
  }

  async get(key: string) {
    try {
      const payload = await this.fs.readFile(this.target(key));
      const iv = payload.slice(0, 12);
      const encrypted = payload.slice(12);
      const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await encryptionKey(), encrypted);
      return { arrayBuffer: async () => decrypted };
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    try { await this.fs.unlink(this.target(key)); } catch { /* Already absent. */ }
  }
}

async function createEnvironment(dataDirectory: string) {
  const sqliteSpecifier = "node:sqlite";
  const fsSpecifier = "node:fs/promises";
  const pathSpecifier = "node:path";
  const [{ DatabaseSync }, fs, path] = await Promise.all([
    dynamicNodeImport<NodeSqliteModule>(sqliteSpecifier),
    dynamicNodeImport<FileSystemModule>(fsSpecifier),
    dynamicNodeImport<PathModule>(pathSpecifier),
  ]);
  const root = path.resolve(dataDirectory);
  await fs.mkdir(root, { recursive: true });
  const database = new DatabaseSync(path.join(root, "revisatucuenta.sqlite"));
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  return {
    DB: new NodeD1Database(database),
    DOCUMENTS: new EncryptedFileBucket(path.join(root, "documents"), fs, path),
  };
}

export async function getNodePersistentEnvironment() {
  const dataDirectory = runtimeEnv("REVISA_DATA_DIR");
  if (!dataDirectory || typeof process === "undefined") return null;
  const environments = runtimeHost.__revisaPersistentEnvironments ??= new Map<string, Promise<any>>();
  let environment = environments.get(dataDirectory);
  if (!environment) {
    environment = createEnvironment(dataDirectory);
    environments.set(dataDirectory, environment);
  }
  return environment;
}
