const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROUTE_ID = /^[A-Za-z0-9_-]{22}$/;

// Fixed mixing values. They only make the address look unrelated to the id; they are not a secret.
const MASK = [0x9e, 0x37, 0x79, 0xb9, 0x7f, 0x4a, 0x7c, 0x15, 0xf3, 0x9c, 0xc0, 0x60, 0x5c, 0xed, 0xc8, 0x34];
const SEED = 0x5a;
// 167 * 23 = 1 (mod 256), so multiplying by one undoes the other.
const MULTIPLY = 167;
const UNMULTIPLY = 23;
const FORWARD = Array.from({ length: 16 }, (_, index) => index);
const BACKWARD = [...FORWARD].reverse();

/** Mixes every byte with the one before it, in the given order, so a one-byte difference spreads along the id. */
function mix(bytes: number[], order: number[]): number[] {
  const out = [...bytes];
  let previous = SEED;
  for (const index of order) {
    previous = (((bytes[index] ?? 0) ^ (MASK[index] ?? 0) ^ previous) * MULTIPLY + 13) & 0xff;
    out[index] = previous;
  }
  return out;
}

function unmix(bytes: number[], order: number[]): number[] {
  const out = [...bytes];
  let previous = SEED;
  for (const index of order) {
    const mixed = bytes[index] ?? 0;
    out[index] = (((mixed - 13) * UNMULTIPLY) & 0xff) ^ (MASK[index] ?? 0) ^ previous;
    previous = mixed;
  }
  return out;
}

/**
 * Short form of a record id for page URLs: the 16 bytes of the UUID, mixed, as URL-safe base64 (22 characters).
 * It keeps addresses short and unreadable, nothing more. Access is always decided by the API, never by this encoding.
 */
export function toRouteId(id: string): string {
  if (!UUID.test(id)) return id;
  const hex = id.replaceAll('-', '');
  const bytes = FORWARD.map((index) => parseInt(hex.slice(index * 2, index * 2 + 2), 16));
  const mixed = mix(mix(bytes, FORWARD), BACKWARD);
  return btoa(String.fromCharCode(...mixed)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** Record id for a URL segment. A plain UUID or anything that is not a short id is returned as it is. */
export function fromRouteId(segment: string): string {
  if (!ROUTE_ID.test(segment)) return segment;
  let text: string;
  try {
    text = atob(segment.replaceAll('-', '+').replaceAll('_', '/'));
  } catch {
    return segment;
  }
  if (text.length !== 16) return segment;
  const bytes = unmix(unmix(Array.from(text, (char) => char.charCodeAt(0)), BACKWARD), FORWARD);
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
