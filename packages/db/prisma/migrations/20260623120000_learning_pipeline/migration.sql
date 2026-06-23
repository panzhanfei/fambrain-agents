-- CreateTable
CREATE TABLE "PendingMemoryFact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "corpusUserId" TEXT NOT NULL,
    "factKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" REAL NOT NULL DEFAULT 0.5,
    "target" TEXT NOT NULL DEFAULT 'MEM0',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sourceConversationId" TEXT,
    "sourceUserQuestion" TEXT,
    "citations" JSONB,
    "learnedPath" TEXT,
    "reviewedAt" DATETIME,
    "reviewedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PendingMemoryFact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RetrievalFeedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "corpusUserId" TEXT NOT NULL,
    "conversationId" TEXT,
    "messageId" TEXT,
    "repoPath" TEXT NOT NULL,
    "signal" INTEGER NOT NULL,
    "query" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RetrievalFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PendingMemoryFact_userId_status_idx" ON "PendingMemoryFact"("userId", "status");

-- CreateIndex
CREATE INDEX "PendingMemoryFact_corpusUserId_status_idx" ON "PendingMemoryFact"("corpusUserId", "status");

-- CreateIndex
CREATE INDEX "RetrievalFeedback_userId_messageId_idx" ON "RetrievalFeedback"("userId", "messageId");

-- CreateIndex
CREATE INDEX "RetrievalFeedback_corpusUserId_repoPath_idx" ON "RetrievalFeedback"("corpusUserId", "repoPath");
