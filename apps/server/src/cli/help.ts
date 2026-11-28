export function helpText(version: string): string {
  return `Larness ${version}

Usage:
  larness start              Start the server in the background and wait until ready
  larness stop               Stop the background server gracefully (PM2 services keep running)
  larness restart            Stop, then start again (not available for pnpm dev instances)
  larness tui                Attach the control panel; quitting it leaves the server running
  larness status [--json]    Show a readable status summary or the machine-readable report
  larness logs [options]     Show recent logs from this data directory
  larness doctor             Run local diagnostics (non-zero on failure)
  larness --version          Print the version
  larness --help             Show this help

Log options:
  --lines <1-1000>           Number of lines to show (default 200)
  --daemon                   Read the background stdout/stderr log instead
  --follow, -f               Keep printing new lines until Ctrl+C

Exit codes:
  0 success   1 failure   2 usage error   3 not running / no logs

Environment:
  LARNESS_DATA_DIR, LARNESS_HOST, LARNESS_PORT, LARNESS_PUBLIC_URL,
  LARNESS_LOG_LEVEL, LARNESS_WEB_DIST

pnpm dev keeps the foreground Vite + source setup; quitting it stops that instance.
larness stop only stops the management server, never PM2 services or deployments.`;
}
