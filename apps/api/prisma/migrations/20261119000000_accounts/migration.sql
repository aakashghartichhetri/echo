-- Keep existing local reports while requiring every future run to have an owner.
CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "githubId" TEXT,
  "login" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "avatarUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastLoginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_githubId_key" ON "User"("githubId");
INSERT INTO "User" ("id", "login", "displayName")
VALUES ('local-demo', 'local-demo', 'Local demo workspace');

CREATE TABLE "Session" (
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("tokenHash")
);
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Run" ADD COLUMN "userId" TEXT;
UPDATE "Run" SET "userId" = 'local-demo';
ALTER TABLE "Run" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "Run" ADD CONSTRAINT "Run_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
DROP INDEX IF EXISTS "Run_createdAt_idx";
CREATE INDEX "Run_userId_createdAt_idx" ON "Run"("userId", "createdAt" DESC);
CREATE INDEX "Run_userId_status_idx" ON "Run"("userId", "status");
