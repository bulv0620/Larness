import { describe, expect, it } from "vitest";
import { assertFetchableUrl } from "../../src/modules/web-search/url.js";

function expectBlocked(url: string): void {
  try {
    assertFetchableUrl(url);
    throw new Error(`expected ${url} to be rejected`);
  } catch (error) {
    expect(error).toMatchObject({ code: "WEB_FETCH_BLOCKED" });
  }
}

describe("web fetch URL policy", () => {
  it("accepts public http(s) URLs", () => {
    expect(assertFetchableUrl("https://example.com/article").hostname).toBe("example.com");
    expect(assertFetchableUrl("http://example.com").protocol).toBe("http:");
  });

  it.each([
    "file:///etc/passwd",
    "ftp://example.com/file",
    "javascript:alert(1)",
    "data:text/plain,hello",
    "https://user:pass@example.com/",
    "http://localhost/",
    "http://localhost:3210/",
    "http://foo.localhost/",
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://10.1.2.3/",
    "http://172.16.0.1/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://metadata.google.internal/",
    "http://service.internal/",
    "http://printer.local/",
    "http://0.0.0.0/",
    "http://224.0.0.1/",
  ])("rejects %s", (url) => {
    expectBlocked(url);
  });

  it("rejects overlong URLs", () => {
    expectBlocked(`https://example.com/${"a".repeat(8_200)}`);
  });

  it("rejects a URL without a host", () => {
    expectBlocked("https://");
  });
});
