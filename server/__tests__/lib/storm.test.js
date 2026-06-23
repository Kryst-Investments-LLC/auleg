/**
 * Unit + integration tests for the STORM pipeline.
 * complete (LLM) and retrieve are injected; prisma is mocked for the
 * STORM -> deep-researcher integration.
 */

jest.mock('../../lib/prisma', () => ({
  enforcementAction: { findFirst: jest.fn(), create: jest.fn() },
  regulatoryGuidance: { findFirst: jest.fn(), create: jest.fn() }
}));
const prisma = require('../../lib/prisma');
const storm = require('../../lib/storm');
const dr = require('../../lib/deep-researcher');

// Branches on the system prompt: planner -> questions, researcher -> finding.
const fakeComplete = async (system) => {
  if (system.includes('research planner')) {
    return '```json\n{"questions":["What are the breach notification deadlines?"]}\n```';
  }
  return JSON.stringify({
    authority: 'EDPB', title: 'Breach notification deadlines', summary: '72 hours',
    implications: 'Notify without undue delay', regulation: 'GDPR',
    clauseImpact: ['breach_notification', 'bogus_clause'],
    sourceUrl: 'https://edpb.europa.eu/g1'
  });
};
const fakeRetrieve = async () => [{ title: 'EDPB guidance', url: 'https://edpb.europa.eu/g1', snippet: '72h' }];

describe('parseJson', () => {
  test('extracts JSON from fenced / noisy text and returns null on garbage', () => {
    expect(storm.parseJson('prefix ```json\n{"a":1}\n``` suffix')).toEqual({ a: 1 });
    expect(storm.parseJson('[1,2,3]')).toEqual([1, 2, 3]);
    expect(storm.parseJson('no json here')).toBeNull();
    expect(storm.parseJson(null)).toBeNull();
  });
});

describe('generateQuestions', () => {
  test('produces perspective-tagged questions and respects the per-perspective cap', async () => {
    const qs = await storm.generateQuestions('breach notification', {
      complete: fakeComplete,
      perspectives: [{ role: 'supervisory authority', focus: 'x' }],
      maxPerPerspective: 1
    });
    expect(qs).toHaveLength(1);
    expect(qs[0].perspective).toBe('supervisory authority');
    expect(qs[0].question).toMatch(/deadline/i);
  });

  test('returns [] when no LLM is configured', async () => {
    expect(await storm.generateQuestions('x', { complete: null })).toEqual([]);
  });
});

describe('researchQuestion', () => {
  test('is sourced when retrieval yields a url', async () => {
    const f = await storm.researchQuestion(
      { perspective: 'supervisory authority', question: 'q' },
      { complete: fakeComplete, retrieve: fakeRetrieve }
    );
    expect(f.sourced).toBe(true);
    expect(f.sourceUrl).toBe('https://edpb.europa.eu/g1');
  });

  test('is unsourced when no url is available anywhere', async () => {
    const noUrl = async () => JSON.stringify({ title: 't', summary: 's' });
    const f = await storm.researchQuestion({ perspective: 'dpo', question: 'q' }, { complete: noUrl });
    expect(f.sourced).toBe(false);
    expect(f.sourceUrl).toBeNull();
  });
});

describe('runStorm', () => {
  test('yields no findings when the LLM returns nothing (no provider configured)', async () => {
    const r = await storm.runStorm('x', { complete: async () => null });
    expect(r.findings).toHaveLength(0);
    expect(r.sourced).toHaveLength(0);
  });

  test('drops unsourced findings from the emitted set and flags review', async () => {
    const complete = async (system) =>
      system.includes('research planner') ? '{"questions":["q1"]}' : '{"title":"t","summary":"s"}';
    const r = await storm.runStorm('breach', {
      complete, perspectives: [{ role: 'r', focus: 'f' }], maxPerPerspective: 1
    });
    expect(r.findings).toHaveLength(1);
    expect(r.sourced).toHaveLength(0);
    expect(r.droppedUnsourced).toBe(1);
    expect(r.needsReview).toBe(true);
  });
});

describe('STORM -> deep researcher integration', () => {
  beforeEach(() => jest.clearAllMocks());

  test('sourced findings ingest into the KB, with clause impact filtered', async () => {
    prisma.regulatoryGuidance.findFirst.mockResolvedValue(null);
    prisma.regulatoryGuidance.create.mockResolvedValue({});

    const source = storm.createStormSource('breach notification', {
      complete: fakeComplete, retrieve: fakeRetrieve,
      perspectives: [{ role: 'supervisory authority', focus: 'x' }], maxPerPerspective: 1
    });

    const r = await dr.runResearchCycle({
      source,
      computeSignals: jest.fn().mockResolvedValue({ breach_notification: { riskMultiplier: 1.2 } })
    });

    expect(r.guidance.added).toBe(1);
    expect(prisma.regulatoryGuidance.create).toHaveBeenCalledTimes(1);
    // The deep researcher filters unknown clause keys out of the STORM output.
    const created = prisma.regulatoryGuidance.create.mock.calls[0][0].data;
    expect(created.clauseImpact).toBe('breach_notification');
    expect(r.hotClauses).toEqual([{ clause: 'breach_notification', riskMultiplier: 1.2 }]);
  });
});
