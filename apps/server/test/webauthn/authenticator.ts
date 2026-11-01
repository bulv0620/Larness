import { createHash, generateKeyPairSync, type KeyObject, randomBytes, sign } from "node:crypto";
import { isoBase64URL, isoCBOR } from "@simplewebauthn/server/helpers";

export interface SoftwareAuthenticator {
  credentialId: Uint8Array;
  privateKey: KeyObject;
  cosePublicKey: Uint8Array;
}

type CborValue = Parameters<typeof isoCBOR.encode>[0];

export function createSoftwareAuthenticator(): SoftwareAuthenticator {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x?: string; y?: string };

  if (jwk.x === undefined || jwk.y === undefined) {
    throw new Error("failed to export EC public key");
  }

  const credentialId = randomBytes(16);

  const cosePublicKey = isoCBOR.encode(
    new Map<number, unknown>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x, "base64url")],
      [-3, Buffer.from(jwk.y, "base64url")],
    ]) as unknown as CborValue,
  );

  return { credentialId, privateKey, cosePublicKey };
}

function base64URL(value: Uint8Array): string {
  return isoBase64URL.fromBuffer(new Uint8Array(value));
}

function rpIdHash(rpId: string): Buffer {
  return createHash("sha256").update(rpId, "utf8").digest();
}

function clientDataJSON(
  type: "webauthn.create" | "webauthn.get",
  challenge: string,
  origin: string,
): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), "utf8");
}

export function registrationResponse(
  authenticator: SoftwareAuthenticator,
  input: { challenge: string; origin: string; rpId: string },
): Record<string, unknown> {
  const counter = Buffer.alloc(4);
  const aaguid = Buffer.alloc(16);
  const credentialIdLength = Buffer.alloc(2);
  credentialIdLength.writeUInt16BE(authenticator.credentialId.length, 0);
  // UP | UV | AT | BE | BS
  const flags = 0x01 | 0x04 | 0x40 | 0x08 | 0x10;

  const authData = Buffer.concat([
    rpIdHash(input.rpId),
    Buffer.from([flags]),
    counter,
    aaguid,
    credentialIdLength,
    Buffer.from(authenticator.credentialId),
    Buffer.from(authenticator.cosePublicKey),
  ]);

  const attestationObject = isoCBOR.encode(
    new Map<string, unknown>([
      ["fmt", "none"],
      ["attStmt", new Map<string, unknown>()],
      ["authData", authData],
    ]) as unknown as CborValue,
  );

  const clientData = clientDataJSON("webauthn.create", input.challenge, input.origin);
  const id = base64URL(authenticator.credentialId);

  return {
    id,
    rawId: id,
    type: "public-key",
    response: {
      clientDataJSON: base64URL(clientData),
      attestationObject: base64URL(attestationObject),
      transports: ["internal"],
    },
    clientExtensionResults: {},
  };
}

export function authenticationResponse(
  authenticator: SoftwareAuthenticator,
  input: { challenge: string; origin: string; rpId: string; counter: number },
): Record<string, unknown> {
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(input.counter, 0);
  const flags = 0x01 | 0x04;

  const authData = Buffer.concat([rpIdHash(input.rpId), Buffer.from([flags]), counter]);
  const clientData = clientDataJSON("webauthn.get", input.challenge, input.origin);
  const clientDataHash = createHash("sha256").update(clientData).digest();
  const signature = sign(
    "sha256",
    Buffer.concat([authData, clientDataHash]),
    authenticator.privateKey,
  );
  const id = base64URL(authenticator.credentialId);

  return {
    id,
    rawId: id,
    type: "public-key",
    response: {
      clientDataJSON: base64URL(clientData),
      authenticatorData: base64URL(authData),
      signature: base64URL(signature),
      userHandle: id,
    },
    clientExtensionResults: {},
  };
}
