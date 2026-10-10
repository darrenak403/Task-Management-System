import argon2 from 'argon2';

// A fixed dummy hash keeps unknown-account login attempts on the Argon2 verification path.
const DUMMY_VERIFICATION_HASH =
  '$argon2id$v=19$m=19456,p=1,t=2$dIHEMOSmeUgGHb4tLzPASA$ZG9BOXvqTCkvp7aJ2A87AIi8+BGHAROAo+eEyk+3RIQ';

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    raw: false,
  });
}

export async function verifyPassword(passwordHash: string | null, password: string): Promise<boolean> {
  try {
    return await argon2.verify(passwordHash ?? DUMMY_VERIFICATION_HASH, password) && passwordHash !== null;
  } catch {
    return false;
  }
}
