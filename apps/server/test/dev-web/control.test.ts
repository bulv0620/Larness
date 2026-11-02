import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { DevWebControl } from "../../src/dev-web/control.js";

it("accepts only the current child generation and a fixed loopback target", () => {
  const generation = randomUUID();
  const child = {};
  const control = new DevWebControl(child, generation);
  const message = { type: "dev-web.ready", generation, host: "127.0.0.1", port: 40123 };
  expect(control.accept({}, message)).toBe(false);
  expect(control.accept(child, { ...message, generation: randomUUID() })).toBe(false);
  expect(control.accept(child, { ...message, host: "example.com" })).toBe(false);
  expect(control.accept(child, { ...message, url: "http://example.com" })).toBe(false);
  expect(control.accept(child, message)).toBe(true);
  expect(control.accept(child, { ...message, port: 40124 })).toBe(false);
  expect(control.accept(child, message)).toBe(true);
  expect(control.target?.port).toBe(40123);
  control.close();
  expect(control.target).toBeNull();
  expect(control.accept(child, message)).toBe(false);
});
