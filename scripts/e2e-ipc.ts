import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectIpc } from "../apps/server/src/ipc/client.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const dataDir = readFileSync(path.join(root, "test-results", "e2e-data-dir"), "utf8").trim();
const [command, ...args] = process.argv.slice(2);
const client = await connectIpc({ dataDir, client: "e2e" });

try {
  if (command === "approve") {
    const [requestId, decision] = args;

    if (requestId === undefined || (decision !== "allow_once" && decision !== "trust")) {
      throw new Error("usage: approve <requestId> <allow_once|trust>");
    }

    console.log(JSON.stringify(await client.request("pairing.approve", { requestId, decision })));
  } else if (command === "devices") {
    console.log(JSON.stringify(await client.request("devices.list")));
  } else if (command === "revoke") {
    const [deviceId] = args;

    if (deviceId === undefined) {
      throw new Error("usage: revoke <deviceId>");
    }

    console.log(JSON.stringify(await client.request("devices.revoke", { deviceId })));
  } else if (command === "sessions") {
    console.log(JSON.stringify(await client.request("sessions.list")));
  } else {
    throw new Error(`unknown command: ${command}`);
  }
} finally {
  client.close();
}
