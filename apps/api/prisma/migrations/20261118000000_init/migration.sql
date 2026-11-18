CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TABLE "Run" (
  "id" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
  "settings" JSONB NOT NULL,
  "report" JSONB,
  "error" TEXT,
  "queries" INTEGER NOT NULL DEFAULT 0,
  "casesChecked" INTEGER NOT NULL DEFAULT 0,
  "stateCount" INTEGER NOT NULL DEFAULT 0,
  "findingCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Run_createdAt_idx" ON "Run"("createdAt" DESC);
