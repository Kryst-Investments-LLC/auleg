/**
 * Unit tests for the LLM clause extractor.
 * Uses an injected fake completion function — no API key, no network.
 */

const { extractClauses, parseClauseResponse, CLAUSE_KEYS } = require('../../lib/llm-extractor');

describe('llm-extractor.parseClauseResponse', () => {
  test('parses clean JSON into a clause map of present clauses', () => {
    const raw = JSON.stringify({
      clauses: {
        breach_notification: { present: true, excerpt: 'notify within 72 hours' },
        liability: { present: false, excerpt: '' }
      }
    });
    const map = parseClauseResponse(raw);
    expect(map).toHaveProperty('breach_notification', 'notify within 72 hours');
    expect(map).not.toHaveProperty('liability');
  });

  test('tolerates markdown code fences and surrounding prose', () => {
    const raw = 'Here is the result:\n```json\n{"clauses":{"audit_rights":{"present":true,"excerpt":""}}}\n```';
    const map = parseClauseResponse(raw);
    expect(map).toHaveProperty('audit_rights');
    // empty excerpt → synthesized label, not empty string
    expect(map.audit_rights).toMatch(/audit/i);
  });

  test('ignores unknown clause keys outside the taxonomy', () => {
    const raw = JSON.stringify({ clauses: { not_a_real_clause: { present: true, excerpt: 'x' } } });
    const map = parseClauseResponse(raw);
    expect(Object.keys(map)).toHaveLength(0);
  });

  test('returns null on unparseable input', () => {
    expect(parseClauseResponse('not json at all')).toBeNull();
    expect(parseClauseResponse('')).toBeNull();
    expect(parseClauseResponse(null)).toBeNull();
  });

  test('taxonomy includes the clause types the regex engine misses', () => {
    expect(CLAUSE_KEYS).toEqual(expect.arrayContaining([
      'data_retention', 'cross_border_transfer', 'liability', 'termination'
    ]));
  });
});

describe('llm-extractor.extractClauses', () => {
  test('returns null when no completion function is available', async () => {
    const result = await extractClauses('some text', { complete: null });
    expect(result).toBeNull();
  });

  test('returns null when the model returns nothing', async () => {
    const result = await extractClauses('some text', { complete: async () => null });
    expect(result).toBeNull();
  });

  test('returns null (fallback) when the model throws', async () => {
    const result = await extractClauses('some text', {
      complete: async () => { throw new Error('rate limited'); }
    });
    expect(result).toBeNull();
  });

  test('extracts clauses from a well-formed completion', async () => {
    const fake = async () => JSON.stringify({
      clauses: {
        breach_notification: { present: true, excerpt: 'breach within 72h' },
        cross_border_transfer: { present: true, excerpt: 'SCCs apply' }
      }
    });
    const map = await extractClauses('a DPA document', { complete: fake });
    expect(Object.keys(map).sort()).toEqual(['breach_notification', 'cross_border_transfer']);
  });

  test('appends org playbook context to the prompt (memory loop)', async () => {
    let capturedUser = '';
    const fake = async (_system, user) => {
      capturedUser = user;
      return JSON.stringify({ clauses: {} });
    };
    await extractClauses('a DPA document', {
      complete: fake,
      playbookContext: '\n## Organization Playbook\n- liability: 3 rejected — this org tends stricter'
    });
    expect(capturedUser).toMatch(/Organization Playbook/);
    expect(capturedUser).toMatch(/3 rejected/);
  });
});
