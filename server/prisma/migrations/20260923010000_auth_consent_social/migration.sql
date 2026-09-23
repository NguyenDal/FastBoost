BEGIN;
CREATE TABLE "RegistrationConsent" (
  "userId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "termsVersion" TEXT NOT NULL,
  "termsAcceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "promotionalEmails" BOOLEAN NOT NULL DEFAULT false,
  "promotionalConsentAt" TIMESTAMP(3)
);
CREATE TABLE "SocialIdentity" (
  "id" TEXT PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "providerUserId" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SocialIdentity_provider_providerUserId_key" ON "SocialIdentity"("provider", "providerUserId");
CREATE UNIQUE INDEX "SocialIdentity_userId_provider_key" ON "SocialIdentity"("userId", "provider");
COMMIT;
