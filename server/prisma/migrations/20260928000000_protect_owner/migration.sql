ALTER TABLE "User" ADD COLUMN "isOwner" BOOLEAN NOT NULL DEFAULT false;

-- One-time designation of the existing, verified site administrator.
-- Ownership stays with this user record if their email or username later changes.
UPDATE "User"
SET "isOwner" = true, "updatedAt" = CURRENT_TIMESTAMP
WHERE "email" = 'annguyen270504@gmail.com'
  AND "username" = 'Starlight'
  AND "role" = 'ADMIN'
  AND "emailVerifiedAt" IS NOT NULL
  AND "suspendedAt" IS NULL;

ALTER TABLE "User" ADD CONSTRAINT "User_owner_protected"
CHECK (NOT "isOwner" OR ("role" = 'ADMIN' AND "suspendedAt" IS NULL));
