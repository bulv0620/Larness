import type { AuthConfig } from "@larness/shared";

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function isLoopbackAddress(address: string): boolean {
  return LOOPBACK_ADDRESSES.has(address);
}

export function transportAllowed(
  request: { ip: string; protocol: string },
  auth: AuthConfig,
): boolean {
  if (!auth.requireHttpsForRemote) {
    return true;
  }

  return isLoopbackAddress(request.ip) || request.protocol === "https";
}
