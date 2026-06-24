/**
 * Unit tests for the memory-loop playbook (prisma mocked).
 */

jest.mock('../../lib/prisma', () => ({
  auditFindingOverride: { create: jest.fn(), findMany: jest.fn() }
}));
const prisma = require('../../lib/prisma');
const {
  aggregatePlaybook, buildPlaybookPromptContext, recordOverride, getOrgPlaybook
} = require('../../lib/playbook');

describe('aggregatePlaybook', () => {
  test('counts actions and derives tendency + avg adjust score per clause', () => {
    const pb = aggregatePlaybook([
      { clause: 'liability', action: 'reject' },
      { clause: 'liability', action: 'reject' },
      { clause: 'liability', action: 'accept' },
      { clause: 'data_retention', action: 'adjust', overrideScore: 60 },
      { clause: 'data_retention', action: 'adjust', overrideScore: 80 }
    ]);
    expect(pb.total).toBe(5);
    expect(pb.clauses.liability.reject).toBe(2);
    expect(pb.clauses.liability.accept).toBe(1);
    expect(pb.clauses.liability.tendency).toBe('stricter');
    expect(pb.clauses.data_retention.adjust).toBe(2);
    expect(pb.clauses.data_retention.avgAdjustScore).toBe(70);
  });

  test('handles empty / undefined input', () => {
    expect(aggregatePlaybook([]).total).toBe(0);
    expect(aggregatePlaybook(undefined).total).toBe(0);
  });
});

describe('buildPlaybookPromptContext', () => {
  test('returns empty string when nothing has been learned', () => {
    expect(buildPlaybookPromptContext({ clauses: {}, total: 0 })).toBe('');
    expect(buildPlaybookPromptContext(null)).toBe('');
  });

  test('renders per-clause guidance including notes', () => {
    const pb = aggregatePlaybook([
      { clause: 'liability', action: 'reject', note: 'we never accept uncapped liability' }
    ]);
    const s = buildPlaybookPromptContext(pb);
    expect(s).toMatch(/Organization Playbook/);
    expect(s).toMatch(/liability/);
    expect(s).toMatch(/stricter/);
    expect(s).toMatch(/uncapped liability/);
  });
});

describe('recordOverride', () => {
  beforeEach(() => jest.clearAllMocks());

  test('rejects an invalid action with status 400 and does not write', async () => {
    await expect(recordOverride({ action: 'bogus' })).rejects.toMatchObject({ status: 400 });
    expect(prisma.auditFindingOverride.create).not.toHaveBeenCalled();
  });

  test('creates a valid override', async () => {
    prisma.auditFindingOverride.create.mockResolvedValue({ id: 'o1' });
    const r = await recordOverride({
      auditId: 'a1', orgId: 'org1', userId: 'u1', userEmail: 'u@x.com',
      clause: 'liability', action: 'reject'
    });
    expect(r.id).toBe('o1');
    expect(prisma.auditFindingOverride.create).toHaveBeenCalledTimes(1);
  });
});

describe('getOrgPlaybook', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns an empty playbook for solo users (no org) without querying', async () => {
    const pb = await getOrgPlaybook(null);
    expect(pb.total).toBe(0);
    expect(prisma.auditFindingOverride.findMany).not.toHaveBeenCalled();
  });

  test('aggregates an org\'s overrides', async () => {
    prisma.auditFindingOverride.findMany.mockResolvedValue([
      { clause: 'security_measures', action: 'accept' },
      { clause: 'security_measures', action: 'accept' }
    ]);
    const pb = await getOrgPlaybook('org1');
    expect(pb.total).toBe(2);
    expect(pb.clauses.security_measures.tendency).toBe('lenient');
  });
});
