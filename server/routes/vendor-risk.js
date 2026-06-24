/**
 * Unified Vendor Risk API — fuses DPA/contract risk with supply-chain
 * (VEX + EPSS) and license risk for a vendor.
 */
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const prisma = require('../lib/prisma');
const { getVendorRisk } = require('../lib/vendor-risk');

router.use(authMiddleware);

/**
 * @swagger
 * /api/vendor-risk/{vendorEntryId}:
 *   get:
 *     summary: Unified risk for a vendor (contract + supply-chain + license)
 *     tags: [VendorRisk]
 *     security: [{ bearerAuth: [] }]
 */
router.get('/:vendorEntryId', async (req, res, next) => {
  try {
    // Access check: the vendor's assessment must belong to the caller / their org.
    const entry = await prisma.vendorEntry.findUnique({
      where: { id: req.params.vendorEntryId },
      include: { assessment: { select: { userId: true, orgId: true } } }
    });
    const a = entry && entry.assessment;
    const ok = a && (a.userId === req.user.id || (req.user.orgId && a.orgId === req.user.orgId));
    if (!ok) return res.status(404).json({ error: 'Vendor not found' });

    const risk = await getVendorRisk(req.params.vendorEntryId);
    if (!risk) return res.status(404).json({ error: 'Vendor not found' });
    res.json(risk);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
