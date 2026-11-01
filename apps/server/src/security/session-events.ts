import { EventEmitter } from "node:events";

export interface SessionRevokedEvent {
  sessionId: string;
  reason: string;
}

export interface DeviceRevokedEvent {
  deviceId: string;
  reason: string;
}

class SessionEventBus extends EventEmitter {}

export const sessionEvents = new SessionEventBus();
sessionEvents.setMaxListeners(50);

export function emitSessionRevoked(sessionId: string, reason: string): void {
  sessionEvents.emit("session.revoked", { sessionId, reason } satisfies SessionRevokedEvent);
}

export function emitDeviceRevoked(deviceId: string, reason: string): void {
  sessionEvents.emit("device.revoked", { deviceId, reason } satisfies DeviceRevokedEvent);
}
