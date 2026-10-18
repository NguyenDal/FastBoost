-- Match-chat send budgets count the sender's recent messages across conversations.
CREATE INDEX "Message_senderId_createdAt_idx" ON "Message"("senderId", "createdAt");
