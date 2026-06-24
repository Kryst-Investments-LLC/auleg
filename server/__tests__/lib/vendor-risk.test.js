/**
 * Unit tests for unified vendor risk fusion (pure scorers + injected orchestrator).
 */
const vr = require('../../lib/vendor-risk');

describe('scoreFromVex', () => {
  test('empty -> 0', () => {
    expect(vr.scoreFromVex([])).toEqual({ score: 0, affectedCount: 0 });
  });

  test('not_affected / fixed contribute nothing', () => {
    const r = vr.scoreFromVex([
      { vulnerability: 'CVE-1', status: 'not_affected' },
      { vulnerability: 'CVE-2', status: 'fixed' }
    ]);
    expect(r).toEqual({ score: 0, affectedCount: 0 });
  });

  test('affected vulns raise risk and EPSS amplifies it', () => {
    const low = vr.scoreFromVex([{ vulnerability: 'CVE-1', status: 'affected' }], {});
    const high = vr.scoreFromVex([{ vulnerability: 'CVE-1', status: 'affected' }], { 'CVE-1': 0.9 });
    expect(high.score).toBeGreaterThan(low.score);
    expect(high.affectedCount).toBe(1);
  });
});

describe('scoreFromLicenses', () => {
  test('blocked is high risk, review moderate, approved none', () => {
    const r = vr.scoreFromLicenses([
      { status: 'blocked' }, { status: 'review' }, { status: 'approved' }
    ]);
    expect(r.blocked).toBe(1);
    expect(r.review).toBe(1);
    expect(r.score).toBe(55); // 40 + 15
  });
});

describe('fuseVendorRisk', () => {
  test('combines dimensions by weight and ranks drivers', () => {
    const f = vr.fuseVendorRisk({
      contractScore: 80,
      vexStatements: [{ vulnerability: 'CVE-1', status: 'affected' }],
      epssScores: { 'CVE-1': 0.95 },
      licenses: [{ status: 'blocked' }]
    });
    expect(f.overall).toBeGreaterThan(0);
    expect(['Low', 'Moderate', 'High', 'Critical']).toContain(f.level);
    expect(f.dimensions.contract.score).toBe(80);
    expect(f.dimensions.supplyChain.affectedVulnerabilities).toBe(1);
    expect(f.topDrivers[0].contribution).toBeGreaterThanOrEqual(f.topDrivers[1].contribution);
  });

  test('a clean vendor scores Low', () => {
    const f = vr.fuseVendorRisk({ contractScore: 10, vexStatements: [], licenses: [] });
    expect(f.level).toBe('Low');
  });
});

describe('getVendorRisk (injected sources)', () => {
  test('returns null when the vendor entry is missing', async () => {
    const r = await vr.getVendorRisk('x', { getVendorEntry: async () => null });
    expect(r).toBeNull();
  });

  test('fuses contract + VEX/EPSS + license data end to end', async () => {
    const r = await vr.getVendorRisk('v1', {
      getVendorEntry: async () => ({ id: 'v1', vendorName: 'Acme', auditId: 'a1', riskScore: 60, orgId: 'org1' }),
      readStatements: async () => [{ vulnerability: 'CVE-2026-1', status: 'affected' }],
      getEpssScores: async () => [{ cve: 'CVE-2026-1', epss: 0.8 }],
      getLicenses: async () => [{ status: 'blocked' }]
    });
    expect(r.vendorName).toBe('Acme');
    expect(r.dimensions.contract.score).toBe(60);
    expect(r.dimensions.supplyChain.affectedVulnerabilities).toBe(1);
    expect(r.dimensions.license.blocked).toBe(1);
    expect(r.overall).toBeGreaterThan(0);
  });
});
