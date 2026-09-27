-- CreateTable
CREATE TABLE "SupportThread" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customerReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "adminReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "attachmentKey" TEXT,
    "attachmentName" TEXT,
    "attachmentMimeType" TEXT,
    "attachmentSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportPresence" (
    "sessionId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportPresence_pkey" PRIMARY KEY ("sessionId")
);

-- CreateTable
CREATE TABLE "SupportEmailAlert" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claim" TEXT,
    "lastError" TEXT,

    CONSTRAINT "SupportEmailAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportThread_customerId_key" ON "SupportThread"("customerId");

-- CreateIndex
CREATE INDEX "SupportThread_lastMessageAt_idx" ON "SupportThread"("lastMessageAt");

-- CreateIndex
CREATE INDEX "SupportMessage_threadId_createdAt_id_idx" ON "SupportMessage"("threadId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SupportMessage_senderId_clientId_key" ON "SupportMessage"("senderId", "clientId");

-- CreateIndex
CREATE INDEX "SupportPresence_expiresAt_idx" ON "SupportPresence"("expiresAt");

-- CreateIndex
CREATE INDEX "SupportEmailAlert_sentAt_nextAttemptAt_idx" ON "SupportEmailAlert"("sentAt", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportEmailAlert_messageId_adminId_key" ON "SupportEmailAlert"("messageId", "adminId");

-- AddForeignKey
ALTER TABLE "SupportThread" ADD CONSTRAINT "SupportThread_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "SupportThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportPresence" ADD CONSTRAINT "SupportPresence_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportEmailAlert" ADD CONSTRAINT "SupportEmailAlert_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "SupportMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportEmailAlert" ADD CONSTRAINT "SupportEmailAlert_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
