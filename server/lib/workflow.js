/**
 * Workflow Engine
 * 
 * Handles negotiation workflows, approval chains,
 * counterparty portal, and bulk vendor assessments.
 */

const crypto = require('crypto');
const prisma = require('./prisma');
const { notify } = require('./notifications');
const {
  buildUserOrgScope,
  requireAccessibleAudit,
  requireScopedRecord,
  canAccessUserOrgRecord,
  forbidden,
  notFound
} = require('./access');

// ─── Negotiation Workflow ─────────────────────────────

async function createNegotiation(user, data) {
  if (data.auditId) {
    await requireAccessibleAudit(user, data.auditId, { select: { id: true } });
  }

  return prisma.negotiation.create({
    data: {
      auditId: data.auditId,
      title: data.title,
      counterparty: data.counterparty,
      status: 'draft',
      userId: user.id,
      orgId: user.orgId || null,
      clauses: {
        create: (data.clauses || []).map(c => ({
          clause: c,
          status: 'open'
        }))
      }
    },
    include: { clauses: true, rounds: true }
  });
}

async function getNegotiations(userId, orgId) {
  const where = orgId ? { orgId } : { userId };
  return prisma.negotiation.findMany({
    where,
    include: { clauses: true, rounds: true, _count: { select: { rounds: true, clauses: true } } },
    orderBy: { updatedAt: 'desc' }
  });
}

async function getNegotiation(id, user) {
  return prisma.negotiation.findFirst({
    where: buildUserOrgScope(user, { id }),
    include: { clauses: true, rounds: true }
  });
}

async function addNegotiationRound(negotiationId, user, data) {
  const neg = await getNegotiation(negotiationId, user);
  if (!neg) throw notFound('Negotiation not found');

  const round = await prisma.negotiationRound.create({
    data: {
      negotiationId,
      roundNumber: neg.currentRound + 1,
      submittedBy: data.submittedBy || 'us',
      auditId: data.auditId,
      notes: data.notes,
      filePath: data.filePath
    }
  });

  await prisma.negotiation.update({
    where: { id: negotiationId },
    data: {
      currentRound: neg.currentRound + 1,
      status: data.submittedBy === 'counterparty' ? 'countered' : 'sent'
    }
  });

  return round;
}

async function updateNegotiationClause(id, user, data) {
  const clause = await prisma.negotiationClause.findUnique({
    where: { id },
    include: {
      negotiation: {
        select: { id: true, userId: true, orgId: true }
      }
    }
  });

  if (!clause || !canAccessUserOrgRecord(user, clause.negotiation)) {
    throw notFound('Negotiation clause not found');
  }

  return prisma.negotiationClause.update({
    where: { id },
    data: {
      status: data.status,
      ourPosition: data.ourPosition,
      theirPosition: data.theirPosition,
      agreedText: data.agreedText,
      notes: data.notes
    }
  });
}

async function updateNegotiationStatus(id, user, status) {
  const negotiation = await getNegotiation(id, user);
  if (!negotiation) {
    throw notFound('Negotiation not found');
  }

  return prisma.negotiation.update({
    where: { id: negotiation.id },
    data: { status }
  });
}

// ─── Approval Chains ──────────────────────────────────

async function createApprovalChain(auditId, user, steps) {
  await requireAccessibleAudit(user, auditId, { select: { id: true } });

  return prisma.approvalChain.create({
    data: {
      auditId,
      title: `Approval for audit ${auditId}`,
      orgId: user.orgId || null,
      steps: {
        create: steps.map((s, i) => ({
          stepOrder: i + 1,
          role: s.role,
          assignedTo: s.assignedTo,
          assignedEmail: s.assignedEmail
        }))
      }
    },
    include: { steps: true }
  });
}

async function getApprovalChains(auditId, user) {
  await requireAccessibleAudit(user, auditId, { select: { id: true } });

  return prisma.approvalChain.findMany({
    where: user.orgId
      ? { auditId, OR: [{ orgId: user.orgId }, { orgId: null }] }
      : { auditId, orgId: null },
    include: { steps: { orderBy: { stepOrder: 'asc' } } }
  });
}

async function processApprovalStep(stepId, user, decision, comments) {
  const step = await prisma.approvalStep.findUnique({
    where: { id: stepId },
    include: { chain: { include: { steps: true } } }
  });
  if (!step) throw notFound('Step not found');

  const assignedToUser = step.assignedTo && step.assignedTo === user.id;
  const assignedToEmail = step.assignedEmail && step.assignedEmail.toLowerCase() === user.email.toLowerCase();
  const sameOrgAdmin = Boolean(step.chain.orgId && user.role === 'admin' && step.chain.orgId === user.orgId);

  if (!assignedToUser && !assignedToEmail && !sameOrgAdmin) {
    throw forbidden('You are not assigned to this approval step');
  }

  if (step.status !== 'pending') throw forbidden('Step already processed');

  // Ensure previous steps are approved
  const prevSteps = step.chain.steps.filter(s => s.stepOrder < step.stepOrder);
  const allPrevApproved = prevSteps.every(s => s.status === 'approved' || s.status === 'skipped');
  if (!allPrevApproved) throw forbidden('Previous approval steps must be completed first');

  await prisma.approvalStep.update({
    where: { id: stepId },
    data: { status: decision, comments, decidedAt: new Date() }
  });

  // Check if all steps are done
  const allSteps = step.chain.steps;
  const updatedSteps = allSteps.map(s => s.id === stepId ? { ...s, status: decision } : s);
  const allDone = updatedSteps.every(s => s.status !== 'pending');
  const anyRejected = updatedSteps.some(s => s.status === 'rejected');

  if (allDone) {
    await prisma.approvalChain.update({
      where: { id: step.chainId },
      data: { status: anyRejected ? 'rejected' : 'approved' }
    });
  } else {
    await prisma.approvalChain.update({
      where: { id: step.chainId },
      data: { status: 'in_progress' }
    });
  }

  return { step: { ...step, status: decision }, chainStatus: allDone ? (anyRejected ? 'rejected' : 'approved') : 'in_progress' };
}

// ─── Counterparty Portal ──────────────────────────────

async function createCounterpartyLink(user, data) {
  if (data.auditId) {
    await requireAccessibleAudit(user, data.auditId, { select: { id: true } });
  }

  if (data.negotiationId) {
    const negotiation = await getNegotiation(data.negotiationId, user);
    if (!negotiation) {
      throw notFound('Negotiation not found');
    }
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + (data.expiryDays || 14) * 24 * 60 * 60 * 1000);

  return prisma.counterpartyLink.create({
    data: {
      token,
      auditId: data.auditId,
      negotiationId: data.negotiationId,
      companyName: data.companyName,
      contactEmail: data.contactEmail,
      expiresAt,
      userId: user.id
    }
  });
}

async function getCounterpartyLink(token) {
  const link = await prisma.counterpartyLink.findUnique({ where: { token } });
  if (!link) return null;
  if (link.expiresAt < new Date()) return null;
  return link;
}

async function submitCounterpartyDPA(token, filePath, auditId) {
  const link = await getCounterpartyLink(token);
  if (!link) throw new Error('Invalid or expired link');

  await prisma.counterpartyLink.update({
    where: { id: link.id },
    data: {
      status: 'submitted',
      submittedFile: filePath,
      submittedAuditId: auditId
    }
  });

  // Notify the link creator
  await notify(link.userId, 'counterparty.submitted',
    'DPA Submitted',
    `${link.companyName} has submitted their DPA for review.`,
    { counterpartyLinkId: link.id, companyName: link.companyName }
  );

  return link;
}

async function getCounterpartyLinks(userId) {
  return prisma.counterpartyLink.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' }
  });
}

// ─── Bulk Vendor Assessment ───────────────────────────

async function createVendorAssessment(user, name) {
  return prisma.vendorAssessment.create({
    data: { name, userId: user.id, orgId: user.orgId || null }
  });
}

async function addVendorToAssessment(user, assessmentId, vendorName, fileName, filePath) {
  const assessment = await requireScopedRecord('vendorAssessment', user, assessmentId);

  const entry = await prisma.vendorEntry.create({
    data: { assessmentId: assessment.id, vendorName, fileName, filePath }
  });

  await prisma.vendorAssessment.update({
    where: { id: assessment.id },
    data: { totalVendors: { increment: 1 } }
  });

  return entry;
}

async function updateVendorEntry(entryId, data) {
  const entry = await prisma.vendorEntry.update({
    where: { id: entryId },
    data: {
      status: data.status,
      auditId: data.auditId,
      riskScore: data.riskScore,
      riskLevel: data.riskLevel
    }
  });

  if (data.status === 'complete') {
    const assessment = await prisma.vendorAssessment.findUnique({
      where: { id: entry.assessmentId },
      include: { vendors: true }
    });

    const completed = assessment.vendors.filter(v => v.status === 'complete' || v.id === entryId);
    const scores = completed.filter(v => v.riskScore != null).map(v => v.riskScore);
    const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b) / scores.length : null;
    const highRiskCount = completed.filter(v => (v.riskLevel === 'High' || v.riskLevel === 'Critical') || (v.riskScore != null && v.riskScore >= 60)).length;

    await prisma.vendorAssessment.update({
      where: { id: entry.assessmentId },
      data: {
        completedVendors: completed.length,
        avgRiskScore: avgScore,
        highRiskCount,
        status: completed.length >= assessment.totalVendors ? 'complete' : 'processing'
      }
    });
  }

  return entry;
}

async function getVendorAssessments(userId, orgId) {
  const where = orgId ? { orgId } : { userId };
  return prisma.vendorAssessment.findMany({
    where,
    include: { vendors: true, _count: { select: { vendors: true } } },
    orderBy: { createdAt: 'desc' }
  });
}

async function getVendorAssessment(id, user) {
  return prisma.vendorAssessment.findFirst({
    where: buildUserOrgScope(user, { id }),
    include: { vendors: { orderBy: { riskScore: 'desc' } } }
  });
}

module.exports = {
  // Negotiation
  createNegotiation,
  getNegotiations,
  getNegotiation,
  addNegotiationRound,
  updateNegotiationClause,
  updateNegotiationStatus,
  // Approval
  createApprovalChain,
  getApprovalChains,
  processApprovalStep,
  // Counterparty
  createCounterpartyLink,
  getCounterpartyLink,
  submitCounterpartyDPA,
  getCounterpartyLinks,
  // Vendor
  createVendorAssessment,
  addVendorToAssessment,
  updateVendorEntry,
  getVendorAssessments,
  getVendorAssessment
};
