/**
 * Workflow Engine
 * 
 * Handles negotiation workflows, approval chains,
 * counterparty portal, and bulk vendor assessments.
 */

const crypto = require('crypto');
const prisma = require('./prisma');
const { notify } = require('./notifications');

// ─── Negotiation Workflow ─────────────────────────────

async function createNegotiation(userId, orgId, data) {
  return prisma.negotiation.create({
    data: {
      auditId: data.auditId,
      title: data.title,
      counterparty: data.counterparty,
      status: 'draft',
      userId,
      orgId,
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

async function getNegotiation(id) {
  return prisma.negotiation.findUnique({
    where: { id },
    include: { clauses: true, rounds: true }
  });
}

async function addNegotiationRound(negotiationId, data) {
  const neg = await prisma.negotiation.findUnique({ where: { id: negotiationId } });
  if (!neg) throw new Error('Negotiation not found');

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

async function updateNegotiationClause(id, data) {
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

async function updateNegotiationStatus(id, status) {
  return prisma.negotiation.update({
    where: { id },
    data: { status }
  });
}

// ─── Approval Chains ──────────────────────────────────

async function createApprovalChain(auditId, orgId, steps) {
  return prisma.approvalChain.create({
    data: {
      auditId,
      title: `Approval for audit ${auditId}`,
      orgId,
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

async function getApprovalChains(auditId) {
  return prisma.approvalChain.findMany({
    where: { auditId },
    include: { steps: { orderBy: { stepOrder: 'asc' } } }
  });
}

async function processApprovalStep(stepId, userId, decision, comments) {
  const step = await prisma.approvalStep.findUnique({
    where: { id: stepId },
    include: { chain: { include: { steps: true } } }
  });
  if (!step) throw new Error('Step not found');
  if (step.status !== 'pending') throw new Error('Step already processed');

  // Ensure previous steps are approved
  const prevSteps = step.chain.steps.filter(s => s.stepOrder < step.stepOrder);
  const allPrevApproved = prevSteps.every(s => s.status === 'approved' || s.status === 'skipped');
  if (!allPrevApproved) throw new Error('Previous approval steps must be completed first');

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

async function createCounterpartyLink(userId, data) {
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
      userId
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

async function createVendorAssessment(userId, orgId, name) {
  return prisma.vendorAssessment.create({
    data: { name, userId, orgId }
  });
}

async function addVendorToAssessment(assessmentId, vendorName, fileName, filePath) {
  const entry = await prisma.vendorEntry.create({
    data: { assessmentId, vendorName, fileName, filePath }
  });

  await prisma.vendorAssessment.update({
    where: { id: assessmentId },
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

async function getVendorAssessment(id) {
  return prisma.vendorAssessment.findUnique({
    where: { id },
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
