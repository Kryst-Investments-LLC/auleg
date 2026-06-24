-- CreateTable
CREATE TABLE "KbReviewItem" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'storm',
    "sourceUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "KbReviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KbReviewItem_status_kind_idx" ON "KbReviewItem"("status", "kind");
