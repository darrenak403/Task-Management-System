import { describe, expect, it } from 'vitest';

import { fromRouteId, toRouteId } from './route-id';

describe('route ids', () => {
  const id = '20000000-0000-4000-8000-000000000001';

  it('shortens a UUID to 22 URL-safe characters and restores it', () => {
    const segment = toRouteId(id);
    expect(segment).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(fromRouteId(segment)).toBe(id);
  });

  it('restores ids whose base64 form uses the URL-safe characters', () => {
    const tricky = 'fbffffff-ffff-4fff-bfff-fffffffffffe';
    expect(fromRouteId(toRouteId(tricky))).toBe(tricky);
  });

  it('gives ids that differ by one digit unrelated-looking addresses', () => {
    const first = toRouteId(id);
    const second = toRouteId('20000000-0000-4000-8000-000000000002');
    expect(first).not.toMatch(/(.)\1{3}/);
    expect([...first].filter((char, index) => char !== second[index]).length).toBeGreaterThan(15);
  });

  it('keeps a plain UUID or an unknown segment as it is', () => {
    expect(fromRouteId(id)).toBe(id);
    expect(fromRouteId('not-an-id')).toBe('not-an-id');
    expect(toRouteId('w1')).toBe('w1');
  });
});
