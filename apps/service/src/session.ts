import { randomBytes, timingSafeEqual } from "node:crypto";
import { isSessionToken } from "@ambient/core";

export const SESSION_TOKEN_HEADER = "x-ambient-session-token";

export function createSessionToken(configuredToken?: string): string {
  if (configuredToken === undefined || configuredToken === "") return randomBytes(32).toString("base64url");
  if (!isSessionToken(configuredToken)) throw new Error("AMBIENT_SESSION_TOKEN must be a 32-byte base64url token");
  return configuredToken;
}

export function matchesSessionToken(candidate: unknown, expected: string): boolean {
  if (typeof candidate !== "string" || candidate.length !== expected.length || Buffer.byteLength(candidate) !== Buffer.byteLength(expected)) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}
