/**
 * Unit tests for the KB human-review gate (prisma mocked, ingest/storm injected).
 */

jest.mock('../../lib/prisma', () => ({
  kbReviewItem: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() }
}));
const prisma = require('../../lib/prisma');
const review = require('../../lib/kb-review');

describe('enqueueFindings', () => {
  beforeEach(() => jest.clearAllMocks());
  test('creates one row per finding with kind, payload, sourceUrl', async () => {
    prisma.kbReviewItem.create.mockResolvedValue({});
    const r = await review.enqueueFindings({
      enforcement: [{ entity: 'A', sourceUrl: 'u1' }],
      guidance: [{ title: 'G', sourceUrl: 'u2' }],
      source: 'storm'
    });
    expect(r.queued).toBe(2);
    expect(prisma.kbReviewItem.create).toHaveBeenCalledTimes(2);
    const first = prisma.kbReviewItem.create.mock.calls[0][0].data;
    expect(first.kind).toBe('enforcement');
    expect(first.sourceUrl).toBe('u1');
    expect(JSON.parse(first.payload).entity).toBe('A');
  });
});

describe('listPending', () => {
  test('queries only pending items, filtered by kind', async () => {
    prisma.kbReviewItem.findMany.mockResolvedValue([{ id: '1' }]);
    await review.listPending({ kind: 'guidance' });
    expect(prisma.kbReviewItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'pending', kind: 'guidance' } })
    );
  });
});

describe('approveItem', () => {
  beforeEach(() => jest.clearAllMocks());

  test('404 when the item is missing', async () => {
    prisma.kbReviewItem.findUnique.mockResolvedValue(null);
    await expect(review.approveItem('x', 'u')).rejects.toMatchObject({ status: 404 });
  });

  test('409 when already reviewed', async () => {
    prisma.kbReviewItem.findUnique.mockResolvedValue({ status: 'approved' });
    await expect(review.approveItem('x', 'u')).rejects.toMatchObject({ status: 409 });
  });

  test('ingests the payload via the researcher and marks approved', async () => {
    prisma.kbReviewItem.findUnique.mockResolvedValue({
      id: '1', status: 'pending', kind: 'guidance', payload: JSON.stringify({ title: 'G' })
    });
    prisma.kbReviewItem.update.mockResolvedValue({});
    const researcher = {
      ingestGuidance: jest.fn().mockResolvedValue({ added: 1, skipped: 0 }),
      ingestEnforcement: jest.fn()
    };
    const r = await review.approveItem('1', 'admin1', { researcher });
    expect(researcher.ingestGuidance).toHaveBeenCalledWith([{ title: 'G' }]);
    expect(researcher.ingestEnforcement).not.toHaveBeenCalled();
    expect(r).toMatchObject({ approved: true, kind: 'guidance' });
    expect(prisma.kbReviewItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'approved', reviewedBy: 'admin1' }) })
    );
  });
});

describe('rejectItem', () => {
  beforeEach(() => jest.clearAllMocks());
  test('marks rejected with a note and does not ingest', async () => {
    prisma.kbReviewItem.findUnique.mockResolvedValue({ id: '1', status: 'pending' });
    prisma.kbReviewItem.update.mockResolvedValue({});
    const r = await review.rejectItem('1', 'admin1', 'not credible');
    expect(r.rejected).toBe(true);
    expect(prisma.kbReviewItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'rejected', reviewNote: 'not credible' }) })
    );
  });
});

describe('enqueueFromStorm', () => {
  beforeEach(() => jest.clearAllMocks());
  test('runs STORM and enqueues its findings for review', async () => {
    prisma.kbReviewItem.create.mockResolvedValue({});
    const storm = {
      createStormSource: () => async () => ({ enforcement: [], guidance: [{ title: 'G', sourceUrl: 'u' }] })
    };
    const r = await review.enqueueFromStorm('breach notification', { storm });
    expect(r.queued).toBe(1);
    expect(prisma.kbReviewItem.create).toHaveBeenCalledTimes(1);
  });
});
