-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "storeName" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "currency" TEXT,
    "niche" TEXT,
    "audience" TEXT,
    "purchasePurpose" TEXT,
    "budget" TEXT,
    "persona" TEXT,
    "primaryPrompt" TEXT,
    "onboardingStep" INTEGER NOT NULL DEFAULT 1,
    "onboardingDone" BOOLEAN NOT NULL DEFAULT false,
    "themeEmbedActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopDomain_key" ON "Shop"("shopDomain");
