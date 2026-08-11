export const SESSION_TOKEN_LENGTH = 43;

const sessionTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function isSessionToken(value: unknown): value is string {
  return typeof value === "string" && value.length === SESSION_TOKEN_LENGTH && sessionTokenPattern.test(value);
}
