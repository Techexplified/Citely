-- CreateTable
CREATE TABLE "TrackedPrompt" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackedPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanJob" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScanJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanMention" (
    "id" TEXT NOT NULL,
    "scanJobId" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "mentioned" BOOLEAN NOT NULL DEFAULT false,
    "rank" INTEGER,
    "rivalCited" TEXT,
    "rawExcerpt" TEXT,

    CONSTRAINT "ScanMention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competitor" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tracked" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiOrder" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "engine" TEXT,
    "productTitle" TEXT,
    "value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "orderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixItem" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "impact" TEXT NOT NULL DEFAULT 'med',
    "status" TEXT NOT NULL DEFAULT 'todo',
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FixItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrackedPrompt_shopId_active_idx" ON "TrackedPrompt"("shopId", "active");

-- CreateIndex
CREATE INDEX "ScanJob_shopId_createdAt_idx" ON "ScanJob"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "ScanMention_scanJobId_idx" ON "ScanMention"("scanJobId");

-- CreateIndex
CREATE INDEX "ScanMention_promptId_idx" ON "ScanMention"("promptId");

-- CreateIndex
CREATE INDEX "Competitor_shopId_idx" ON "Competitor"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "Competitor_shopId_name_key" ON "Competitor"("shopId", "name");

-- CreateIndex
CREATE INDEX "AiOrder_shopId_orderedAt_idx" ON "AiOrder"("shopId", "orderedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiOrder_shopId_orderId_key" ON "AiOrder"("shopId", "orderId");

-- CreateIndex
CREATE INDEX "FixItem_shopId_status_idx" ON "FixItem"("shopId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FixItem_shopId_key_key" ON "FixItem"("shopId", "key");

-- AddForeignKey
ALTER TABLE "TrackedPrompt" ADD CONSTRAINT "TrackedPrompt_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanJob" ADD CONSTRAINT "ScanJob_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanMention" ADD CONSTRAINT "ScanMention_scanJobId_fkey" FOREIGN KEY ("scanJobId") REFERENCES "ScanJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanMention" ADD CONSTRAINT "ScanMention_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "TrackedPrompt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Competitor" ADD CONSTRAINT "Competitor_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiOrder" ADD CONSTRAINT "AiOrder_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixItem" ADD CONSTRAINT "FixItem_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
