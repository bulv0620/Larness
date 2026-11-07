import { describe, expect, it } from "vitest";
import {
  assertSafeEndpoint,
  EndpointError,
  isPrivateAddress,
} from "../../src/modules/models/endpoint.js";

const publicResolver = async () => ["93.184.216.34"];
const privateResolver = async () => ["10.0.0.5"];

describe("model endpoint safety", () => {
  it("accepts public HTTPS endpoints", async () => {
    await expect(
      assertSafeEndpoint("https://api.example.com/v1", publicResolver),
    ).resolves.toBeInstanceOf(URL);
    await expect(
      assertSafeEndpoint("https://93.184.216.34/v1", publicResolver),
    ).resolves.toBeInstanceOf(URL);
  });

  it("rejects non-HTTPS, credentials, loopback and internal names", async () => {
    const never = async () => {
      throw new Error("resolver must not run");
    };

    for (const url of [
      "http://api.example.com",
      "https://user:pass@api.example.com",
      "https://localhost",
      "https://app.localhost",
      "https://printer.local",
      "https://metadata.google.internal",
      "https://127.0.0.1",
      "https://10.0.0.1",
      "https://[::1]",
    ]) {
      await expect(assertSafeEndpoint(url, never)).rejects.toBeInstanceOf(EndpointError);
    }
  });

  it("rejects hostnames resolving to private or mixed addresses", async () => {
    await expect(
      assertSafeEndpoint("https://api.example.com", privateResolver),
    ).rejects.toBeInstanceOf(EndpointError);
    await expect(
      assertSafeEndpoint("https://api.example.com", async () => ["93.184.216.34", "192.168.1.1"]),
    ).rejects.toBeInstanceOf(EndpointError);
  });

  it("classifies private address ranges", () => {
    expect(isPrivateAddress("10.1.2.3")).toBe(true);
    expect(isPrivateAddress("172.16.0.1")).toBe(true);
    expect(isPrivateAddress("172.32.0.1")).toBe(false);
    expect(isPrivateAddress("192.168.1.1")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("fd00::1")).toBe(true);
    expect(isPrivateAddress("2001:db8::1")).toBe(true);
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
  });
});
