import { isPrivateAddress } from "../models/endpoint.js";
import { WebSearchError } from "./errors.js";

const MAX_URL_LENGTH = 8_192;

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

function blocked(message: string): WebSearchError {
  return new WebSearchError("WEB_FETCH_BLOCKED", message);
}

/**
 * Public http(s) pages only. The actual fetch happens on the provider side, but
 * rejecting loopback/private/metadata targets here keeps the tool from being
 * used as a proxy for internal discovery, and makes the rule testable.
 */
export function assertFetchableUrl(raw: string): URL {
  if (raw.length > MAX_URL_LENGTH) {
    throw blocked("URL is too long");
  }

  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw blocked("URL is not valid");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw blocked("only http and https URLs are allowed");
  }

  if (url.username.length > 0 || url.password.length > 0) {
    throw blocked("URL must not contain credentials");
  }

  const hostname = normalizeHostname(url.hostname);

  if (hostname.length === 0) {
    throw blocked("URL host is required");
  }

  if (
    BLOCKED_HOSTS.has(hostname) ||
    BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix)) ||
    isPrivateAddress(hostname)
  ) {
    throw blocked("该地址不允许抓取");
  }

  return url;
}
