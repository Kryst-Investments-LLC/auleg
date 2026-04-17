/**
 * VEX Routes — /api/vex
 *
 * CRUD for VEX (Vulnerability Exploitability eXchange) statements.
 * Statements are stored as JSON files under vex-data/<auditId>/.
 *
 * Hardening:
 *   - All handlers are async-aware (lib/vex is now Promise-based).
 *   - DELETE requires explicit ?confirm=true to prevent accidental
 *     bulk-deletion via leaked API key + Authorization-header CSRF bypass.
 */

const express = require('express');
const authMiddleware = require('../middleware/auth');
const { requireAccessibleAudit } = require('../lib/access');
const { saveStatement, readStatements, readStatement, deleteStatements } = require('../lib/vex');

const router = express.Router();
router.use(authMiddleware);

const ALLOWED_STATUSES = ['not_affected', 'affected', 'fixed', 'under_investigation'];

/**
 * POST /api/vex/:auditId
 * Create a VEX statement for an audit.
 */
router.post('/:auditId', async (req, res, next) => {
  try {
    await requireAccessibleAudit(req.user, req.params.auditId, { select: { id: true } });
    const { vulnerability, product, status, justification } = req.body || {};
    if (!vulnerability || !product || !status) {
      return res.status(400).json({ error: 'vulnerability, product, and status are required' });
    }
    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${ALLOWED_STATUSES.join(', ')}` });
    }
    const result = await saveStatement(req.params.auditId, {
      vulnerability, product, status, justification,
    });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

/**
 * GET /api/vex/:auditId
 * List all VEX statements for an audit.
 */
router.get('/:auditId', async (req, res, next) => {
  try {
    await requireAccessibleAudit(req.user, req.params.auditId, { select: { id: true } });
    const statements = await readStatements(req.params.auditId);
    res.json({ statements, count: statements.length });
  } catch (err) { next(err); }
});

/**
 * GET /api/vex/:auditId/:statementId
 * Get a single VEX statement.
 */
router.get('/:auditId/:statementId', async (req, res, next) => {
  try {
    await requireAccessibleAudit(req.user, req.params.auditId, { select: { id: true } });
    const stmt = await readStatement(req.params.auditId, req.params.statementId);
    if (!stmt) return res.status(404).json({ error: 'Statement not found' });
    res.json(stmt);
  } catch (err) { next(err); }
});

/**
 * DELETE /api/vex/:auditId?confirm=true
 * Delete all VEX statements for an audit. Requires explicit confirmation
 * because Authorization-header requests bypass CSRF protection.
 */
router.delete('/:auditId', async (req, res, next) => {
  try {
    if (req.query.confirm !== 'true') {
      return res.status(400).json({
        error: 'Bulk delete requires confirmation. Append ?confirm=true to the URL.',
      });
    }
    await requireAccessibleAudit(req.user, req.params.auditId, { select: { id: true } });
    const removed = await deleteStatements(req.params.auditId);
    res.json({ message: `Deleted ${removed} VEX statement(s)` });
  } catch (err) { next(err); }
});

module.exports = router;
