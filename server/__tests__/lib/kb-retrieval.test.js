/**
 * Tests for the KB-backed STORM retrieval source (injected getters).
 */
const { kbRetrieve } = require('../../lib/kb-retrieval');

const enforcement = [
  { authority: 'CNIL', entity: 'AdTech Co', summary: 'cookie consent violation', impact: 'fine', regulation: 'GDPR', sourceUrl: 'https://cnil.fr/1' },
  { authority: 'ICO', entity: 'NoUrl Co', summary: 'breach notification failure', impact: 'fine', regulation: 'GDPR', sourceUrl: null }
];
const guidance = [
  { title: 'SCC transfer guidance', summary: 'cross-border transfers', implications: 'use SCCs', authority: 'EDPB', regulation: 'GDPR', sourceUrl: 'https://edpb.europa.eu/2' }
];
const inject = { getEnforcementActions: async () => enforcement, getGuidance: async () => guidance };

describe('kbRetrieve', () => {
  test('returns sourced enforcement matches for query terms', async () => {
    const r = await kbRetrieve('cookie consent', inject);
    expect(r).toHaveLength(1);
    expect(r[0].url).toBe('https://cnil.fr/1');
    expect(r[0].snippet).toMatch(/cookie/);
  });

  test('excludes matching items that have no sourceUrl', async () => {
    const r = await kbRetrieve('breach notification', inject);
    expect(r).toEqual([]); // matching enforcement has sourceUrl: null
  });

  test('matches guidance as well as enforcement', async () => {
    const r = await kbRetrieve('cross-border transfer', inject);
    expect(r.some(s => s.url === 'https://edpb.europa.eu/2')).toBe(true);
  });

  test('returns [] for an empty / too-short query', async () => {
    expect(await kbRetrieve('', inject)).toEqual([]);
    expect(await kbRetrieve('a b', inject)).toEqual([]);
  });

  test('degrades to [] if a getter throws', async () => {
    const r = await kbRetrieve('cookie', {
      getEnforcementActions: async () => { throw new Error('db down'); },
      getGuidance: async () => guidance
    });
    expect(Array.isArray(r)).toBe(true);
  });
});
