/**
 * Unit tests for the deep researcher (prisma mocked, source injected).
 */

jest.mock('../../lib/prisma', () => ({
  enforcementAction: { findFirst: jest.fn(), create: jest.fn() },
  regulatoryGuidance: { findFirst: jest.fn(), create: jest.fn() }
}));
const prisma = require('../../lib/prisma');
const dr = require('../../lib/deep-researcher');

describe('normalizeClauseImpact', () => {
  test('keeps known clause keys, drops unknown, accepts array or string', () => {
    expect(dr.normalizeClauseImpact(['liability', 'bogus', 'breach_notification']))
      .toBe('liability,breach_notification');
    expect(dr.normalizeClauseImpact('liability, nope , data_retention'))
      .toBe('liability,data_retention');
    expect(dr.normalizeClauseImpact(null)).toBe('');
  });
});

describe('normalizeEnforcement', () => {
  test('applies defaults, filters clause impact, clamps severity, parses date', () => {
    const n = dr.normalizeEnforcement({
      authority: 'ICO', entity: 'Acme', date: '2026-01-01',
      fineAmount: 1000000, clauseImpact: ['liability', 'x'], severity: 'extreme'
    });
    expect(n.authority).toBe('ICO');
    expect(n.regulation).toBe('GDPR');
    expect(n.clauseImpact).toBe('liability');
    expect(n.severity).toBe('medium');
    expect(n.date instanceof Date).toBe(true);
    expect(n.fineAmount).toBe(1000000);
  });
});

describe('ingestEnforcement', () => {
  beforeEach(() => jest.clearAllMocks());
  test('creates new findings and skips duplicates', async () => {
    prisma.enforcementAction.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'existing' });
    prisma.enforcementAction.create.mockResolvedValue({});
    const r = await dr.ingestEnforcement([
      { authority: 'ICO', entity: 'A', date: '2026-01-01', sourceUrl: 'u1' },
      { authority: 'ICO', entity: 'B', date: '2026-01-02', sourceUrl: 'u2' }
    ]);
    expect(r).toEqual({ added: 1, skipped: 1 });
    expect(prisma.enforcementAction.create).toHaveBeenCalledTimes(1);
  });
});

describe('runResearchCycle', () => {
  beforeEach(() => jest.clearAllMocks());

  test('skips when no source is configured', async () => {
    const r = await dr.runResearchCycle({});
    expect(r).toMatchObject({ skipped: true, reason: 'no-source' });
  });

  test('handles a failing source gracefully', async () => {
    const r = await dr.runResearchCycle({ source: async () => { throw new Error('feed down'); } });
    expect(r).toMatchObject({ skipped: true, reason: 'source-error' });
  });

  test('ingests new findings and recomputes risk signals', async () => {
    prisma.enforcementAction.findFirst.mockResolvedValue(null);
    prisma.enforcementAction.create.mockResolvedValue({});
    prisma.regulatoryGuidance.findFirst.mockResolvedValue(null);
    prisma.regulatoryGuidance.create.mockResolvedValue({});
    const computeSignals = jest.fn().mockResolvedValue({
      liability: { riskMultiplier: 1.3 },
      termination: { riskMultiplier: 1.0 }
    });
    const source = async () => ({
      enforcement: [{ authority: 'CNIL', entity: 'X', date: '2026-02-01', clauseImpact: ['liability'], sourceUrl: 'e1' }],
      guidance: [{ authority: 'EDPB', title: 'New SCC guidance', date: '2026-02-02', sourceUrl: 'g1' }]
    });
    const r = await dr.runResearchCycle({ source, computeSignals });
    expect(r.enforcement.added).toBe(1);
    expect(r.guidance.added).toBe(1);
    expect(computeSignals).toHaveBeenCalledTimes(1);
    expect(r.hotClauses).toEqual([{ clause: 'liability', riskMultiplier: 1.3 }]);
  });

  test('does not recompute signals when everything is a duplicate', async () => {
    prisma.enforcementAction.findFirst.mockResolvedValue({ id: 'dup' });
    const computeSignals = jest.fn();
    const source = async () => ({
      enforcement: [{ authority: 'ICO', entity: 'Y', date: '2026-01-01', sourceUrl: 'dup' }]
    });
    const r = await dr.runResearchCycle({ source, computeSignals });
    expect(r.enforcement.added).toBe(0);
    expect(computeSignals).not.toHaveBeenCalled();
    expect(r.hotClauses).toEqual([]);
  });
});
