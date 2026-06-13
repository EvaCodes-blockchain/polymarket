-- CreateTable
CREATE TABLE "bridge_chains" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "chainId" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "transport" TEXT NOT NULL,
    "transportLabel" TEXT NOT NULL,
    "collateral" TEXT NOT NULL,
    "accent" TEXT NOT NULL,
    "explorerUrl" TEXT,
    "blurb" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "bridge_chains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_systems" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "logoUrl" TEXT,
    "blurb" TEXT NOT NULL,
    "websiteUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "bridge_systems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_markets" (
    "id" TEXT NOT NULL,
    "systemKey" TEXT NOT NULL,
    "chainKey" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "imageUrl" TEXT,
    "priceYes" DOUBLE PRECISION NOT NULL,
    "volumeUsdc" DOUBLE PRECISION NOT NULL,
    "liquidityUsdc" DOUBLE PRECISION NOT NULL,
    "outcomeYes" TEXT NOT NULL DEFAULT 'Yes',
    "outcomeNo" TEXT NOT NULL DEFAULT 'No',
    "closeTime" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'LIVE',
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "external_markets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bridge_chains_key_key" ON "bridge_chains"("key");

-- CreateIndex
CREATE UNIQUE INDEX "bridge_systems_key_key" ON "bridge_systems"("key");

-- CreateIndex
CREATE INDEX "external_markets_chainKey_idx" ON "external_markets"("chainKey");

-- CreateIndex
CREATE INDEX "external_markets_systemKey_idx" ON "external_markets"("systemKey");

-- AddForeignKey
ALTER TABLE "external_markets" ADD CONSTRAINT "external_markets_systemKey_fkey" FOREIGN KEY ("systemKey") REFERENCES "bridge_systems"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_markets" ADD CONSTRAINT "external_markets_chainKey_fkey" FOREIGN KEY ("chainKey") REFERENCES "bridge_chains"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
