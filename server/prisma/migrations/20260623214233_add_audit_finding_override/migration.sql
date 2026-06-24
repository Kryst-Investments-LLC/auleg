-- CreateTable
CREATE TABLE "AuditFindingOverride" (
    "id" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "orgId" TEXT,
    "userId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "clause" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "originalScore" INTEGER,
    "overrideScore" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditFindingOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditFindingOverride_orgId_clause_idx" ON "AuditFindingOverride"("orgId", "clause");

-- CreateIndex
CREATE INDEX "AuditFindingOverride_auditId_idx" ON "AuditFindingOverride"("auditId");

-- AddForeignKey
ALTER TABLE "AuditFindingOverride" ADD CONSTRAINT "AuditFindingOverride_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
