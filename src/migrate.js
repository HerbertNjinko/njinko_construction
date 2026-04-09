import { closeDatabasePool } from "./postgres.js";
import { runPendingMigrations } from "./migrations.js";

try {
  const pending = await runPendingMigrations();

  if (!pending.length) {
    process.stdout.write("No pending migrations.\n");
  } else {
    process.stdout.write(`Applied migrations:\n- ${pending.join("\n- ")}\n`);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
} finally {
  await closeDatabasePool();
}
