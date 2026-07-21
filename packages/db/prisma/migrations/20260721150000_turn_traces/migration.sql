-- CreateTable
CREATE TABLE "TurnTrace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userMessageId" TEXT,
    "userQuestion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'done',
    "timing" JSONB,
    "entries" JSONB NOT NULL,
    "steps" JSONB NOT NULL,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TurnTrace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TurnTrace_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TurnTrace_messageId_key" ON "TurnTrace"("messageId");

-- CreateIndex
CREATE INDEX "TurnTrace_conversationId_createdAt_idx" ON "TurnTrace"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "TurnTrace_userId_conversationId_idx" ON "TurnTrace"("userId", "conversationId");
