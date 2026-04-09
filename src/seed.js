import { closeDatabasePool } from "./postgres.js";
import { seedDatabase } from "./database.js";

const force = process.argv.includes("--force");

try {
  const result = await seedDatabase({ force });
  process.stdout.write(
    `Seed complete: ${result.participants} participants, ${result.users} users, ${result.deals} deals, ${result.positions} positions.\n`
  );
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
} finally {
  await closeDatabasePool();
}
