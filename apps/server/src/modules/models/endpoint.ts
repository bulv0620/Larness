import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class EndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EndpointError";
  }
}

export type HostResolver = (hostname: string) => Promise<string[]>;

const defaultResolver: HostResolver = async (hostname) => {
  const entries = await lookup(hostname, { all: true, verbatim: true });
  return entries.map((entry) => entry.address);
};

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data",
]);

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

function normalizeHostname(hostname: string): string {
  const lower = hostname.toLowerCase().replace(/\.$/, "");
  return lower.startsWith("[") && lower.endsWith("]") ? lower.slice(1, -1) : lower;
}

function isBlockedHostname(hostname: string): boolean {
  return (
    BLOCKED_HOSTS.has(hostname) || BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  );
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");

  if (parts.length !== 4) {
    return null;
  }

  const octets = parts.map((part) => Number(part));

  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }

  return octets;
}

function isPrivateIpv4(address: string): boolean {
  const octets = parseIpv4(address);

  if (octets === null) {
    return false;
  }

  const [a, b] = octets as [number, number, number, number];

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);

  if (mapped?.[1] !== undefined) {
    return isPrivateIpv4(mapped[1]);
  }

  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb") ||
    lower.startsWith("ff") ||
    lower.startsWith("2001:db8:")
  );
}

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? isPrivateIpv4(address) : family === 6 ? isPrivateIpv6(address) : false;
}

/**
 * Validates a user-supplied OpenAI-compatible endpoint. Only public HTTPS
 * origins are allowed; loopback, private, link-local, metadata and internal
 * names are rejected before any request is made.
 */
export async function assertSafeEndpoint(
  raw: string,
  resolver: HostResolver = defaultResolver,
): Promise<URL> {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new EndpointError("endpoint must be a valid URL");
  }

  if (url.protocol !== "https:") {
    throw new EndpointError("endpoint must use https");
  }

  if (url.username.length > 0 || url.password.length > 0) {
    throw new EndpointError("endpoint must not contain credentials");
  }

  const hostname = normalizeHostname(url.hostname);

  if (hostname.length === 0) {
    throw new EndpointError("endpoint host is required");
  }

  if (isBlockedHostname(hostname)) {
    throw new EndpointError("endpoint host is not allowed");
  }

  const addresses = isIP(hostname) > 0 ? [hostname] : await resolver(hostname);

  if (addresses.length === 0) {
    throw new EndpointError("endpoint host cannot be resolved");
  }

  if (addresses.some((address) => isPrivateAddress(address))) {
    throw new EndpointError("endpoint must resolve to a public address");
  }

  return url;
}
