INSERT INTO "Service" ("id", "title", "description", "createdAt", "updatedAt")
SELECT
    'service_rank_boost',
    'Rank Boost',
    'Climb from your current rank to your desired League of Legends rank.',
    NOW(),
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM "Service" WHERE "title" = 'Rank Boost'
);

INSERT INTO "Service" ("id", "title", "description", "createdAt", "updatedAt")
SELECT
    'service_placement_boost',
    'Placement Boost',
    'Complete your League of Legends placement matches with professional assistance.',
    NOW(),
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM "Service" WHERE "title" = 'Placement Boost'
);

INSERT INTO "Service" ("id", "title", "description", "createdAt", "updatedAt")
SELECT
    'service_win_boost',
    'Win Boost',
    'Order a selected number of ranked League of Legends wins.',
    NOW(),
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM "Service" WHERE "title" = 'Win Boost'
);

INSERT INTO "Service" ("id", "title", "description", "createdAt", "updatedAt")
SELECT
    'service_pro_duo',
    'Pro Duo',
    'Play alongside an experienced League of Legends booster.',
    NOW(),
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM "Service" WHERE "title" = 'Pro Duo'
);

INSERT INTO "Service" ("id", "title", "description", "createdAt", "updatedAt")
SELECT
    'service_tft_rank_boost',
    'TFT Rank Boost',
    'Climb from your current Teamfight Tactics rank to your desired rank.',
    NOW(),
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM "Service" WHERE "title" = 'TFT Rank Boost'
);

INSERT INTO "Service" ("id", "title", "description", "createdAt", "updatedAt")
SELECT
    'service_tft_win_boost',
    'TFT Win Boost',
    'Order a selected number of Teamfight Tactics wins.',
    NOW(),
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM "Service" WHERE "title" = 'TFT Win Boost'
);

INSERT INTO "Service" ("id", "title", "description", "createdAt", "updatedAt")
SELECT
    'service_tft_placement_boost',
    'TFT Placement Boost',
    'Complete your Teamfight Tactics placement games with professional assistance.',
    NOW(),
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM "Service" WHERE "title" = 'TFT Placement Boost'
);