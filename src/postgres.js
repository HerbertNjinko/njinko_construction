import pg from "pg";

const { Pool } = pg;
const DEFAULT_PORT = 5432;

function requireEnvString(name) {
  const value = process.env[name];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `Missing Postgres setting: ${name}. Set ${name} or use DATABASE_URL before starting the app.`
    );
  }

  return value;
}

export function buildConnectionConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined
    };
  }

  return {
    host: process.env.PGHOST ?? "127.0.0.1",
    port: Number(process.env.PGPORT ?? DEFAULT_PORT),
    user: process.env.PGUSER ?? "postgres",
    password: requireEnvString("PGPASSWORD"),
    database: process.env.PGDATABASE ?? "investors",
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined
  };
}

export const pool = new Pool(buildConnectionConfig());

export async function queryAll(sql, params = [], executor = pool) {
  const result = await executor.query(sql, params);
  return result.rows;
}

export async function queryOne(sql, params = [], executor = pool) {
  const rows = await queryAll(sql, params, executor);
  return rows[0] ?? null;
}

export async function withTransaction(callback) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    throw error;
  } finally {
    client.release();
  }
}

export async function closeDatabasePool() {
  await pool.end();
}
