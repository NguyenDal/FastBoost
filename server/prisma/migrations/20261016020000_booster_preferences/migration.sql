CREATE TABLE "BoosterPreferences" (
  "userId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "firstRole" TEXT CHECK ("firstRole" IN ('Top', 'Jungle', 'Middle', 'Bottom', 'Support')),
  "secondRole" TEXT CHECK ("secondRole" IN ('Fill', 'Top', 'Jungle', 'Middle', 'Bottom', 'Support')),
  "championIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BoosterPreferences_distinct_roles" CHECK ("firstRole" IS DISTINCT FROM "secondRole" OR "secondRole" IS NULL),
  CONSTRAINT "BoosterPreferences_second_requires_first" CHECK ("firstRole" IS NOT NULL OR "secondRole" IS NULL),
  CONSTRAINT "BoosterPreferences_champion_limit" CHECK (cardinality("championIds") <= 5)
);
