import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { pool, queryAll, queryOne, withTransaction } from "./postgres.js";

const MIGRATIONS_DIR = join(process.cwd(), "migrations");
const MIGRATIONS_TABLE = "schema_migrations";
const REQUIRED_TABLES = [
  "participants",
  "users",
  "password_reset_tokens",
  "deals",
  "promote_tiers",
  "deal_timeline_items",
  "positions",
  "contractor_participation",
  "email_notifications",
  "company_resources",
  "distribution_elections",
  "early_withdrawal_requests",
  "deal_issues",
  "deal_issue_votes",
  "deal_debt_service_entries",
  "deal_expense_entries",
  "investor_pools",
  "investor_pool_commitments",
  "investor_pool_votes",
  "archived_records",
  "user_legal_acknowledgements",
  "investor_questionnaires"
];

function listMigrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));
}

async function ensureMigrationsTable(executor = pool) {
  await executor.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function hasMigrationsTable() {
  const row = await queryOne(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = '${MIGRATIONS_TABLE}'
    ) AS "exists"
  `);

  return Boolean(row?.exists);
}

async function getAppliedMigrationNames() {
  if (!(await hasMigrationsTable())) {
    return [];
  }

  const rows = await queryAll(`
    SELECT name
    FROM ${MIGRATIONS_TABLE}
    ORDER BY applied_at, name
  `);

  return rows.map((row) => row.name);
}

async function getPendingMigrationNames() {
  const files = listMigrationFiles();
  const applied = new Set(await getAppliedMigrationNames());

  return files.filter((file) => !applied.has(file));
}

export async function runPendingMigrations() {
  if (!listMigrationFiles().length) {
    throw new Error("No migration files were found.");
  }

  await ensureMigrationsTable();
  const pending = await getPendingMigrationNames();

  for (const file of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");

    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query(
        `
          INSERT INTO ${MIGRATIONS_TABLE} (name)
          VALUES ($1)
        `,
        [file]
      );
    });
  }

  return pending;
}

export async function assertDatabaseReady() {
  if (!(await hasMigrationsTable())) {
    throw new Error("Database is not migrated. Run `npm run migrate` before starting the app.");
  }

  const pending = await getPendingMigrationNames();

  if (pending.length) {
    throw new Error(
      `Database has pending migrations: ${pending.join(", ")}. Run \`npm run migrate\`.`
    );
  }

  const rows = await queryAll(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
    `,
    [REQUIRED_TABLES]
  );
  const existing = new Set(rows.map((row) => row.table_name));
  const missing = REQUIRED_TABLES.filter((tableName) => !existing.has(tableName));

  if (missing.length) {
    throw new Error(
      `Database is missing required tables: ${missing.join(", ")}. Run \`npm run migrate\`.`
    );
  }
}
