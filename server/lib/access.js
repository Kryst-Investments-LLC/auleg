const prisma = require('./prisma');

function notFound(message = 'Not found') {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function forbidden(message = 'Forbidden') {
  const err = new Error(message);
  err.status = 403;
  return err;
}

function buildUserOrgScope(user, where = {}) {
  if (user.orgId) {
    return {
      ...where,
      OR: [
        { userId: user.id },
        { orgId: user.orgId }
      ]
    };
  }

  return {
    ...where,
    userId: user.id
  };
}

function buildAuditScope(user, auditId, where = {}) {
  return {
    ...where,
    id: auditId,
    OR: [
      { userId: user.id },
      ...(user.orgId ? [{ orgId: user.orgId }] : [])
    ]
  };
}

async function getAccessibleAudit(user, auditId, options = {}) {
  const { where = {}, ...rest } = options;

  return prisma.audit.findFirst({
    ...rest,
    where: buildAuditScope(user, auditId, where)
  });
}

async function requireAccessibleAudit(user, auditId, options = {}) {
  const audit = await getAccessibleAudit(user, auditId, options);
  if (!audit) {
    throw notFound('Audit not found');
  }

  return audit;
}

async function getScopedRecord(modelName, user, recordId, options = {}) {
  const { where = {}, ...rest } = options;

  return prisma[modelName].findFirst({
    ...rest,
    where: buildUserOrgScope(user, { ...where, id: recordId })
  });
}

async function requireScopedRecord(modelName, user, recordId, options = {}) {
  const record = await getScopedRecord(modelName, user, recordId, options);
  if (!record) {
    throw notFound();
  }

  return record;
}

function canAccessUserOrgRecord(user, record) {
  return Boolean(record && (record.userId === user.id || (user.orgId && record.orgId === user.orgId)));
}

module.exports = {
  buildUserOrgScope,
  getAccessibleAudit,
  requireAccessibleAudit,
  getScopedRecord,
  requireScopedRecord,
  canAccessUserOrgRecord,
  forbidden,
  notFound
};