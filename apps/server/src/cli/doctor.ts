import { runDoctor } from "../doctor.js";

try {
  const report = await runDoctor();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (report.checks.some((check) => check.status === "fail")) {
    process.exitCode = 1;
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[larness] doctor failed: ${message}\n`);
  process.exitCode = 1;
}
