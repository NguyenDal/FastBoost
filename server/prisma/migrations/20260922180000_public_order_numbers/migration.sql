BEGIN;
CREATE TABLE "OrderNumberReservation" ("suffix" TEXT NOT NULL PRIMARY KEY);
ALTER TABLE "Order" ADD COLUMN "orderNumber" TEXT;

CREATE FUNCTION fastboost_order_prefix(boost_type TEXT) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  game TEXT := CASE WHEN boost_type ILIKE 'TFT %' THEN 'TFT' ELSE 'LOL' END;
  service TEXT := regexp_replace(boost_type, '^TFT\s+', '', 'i');
  code TEXT;
BEGIN
  code := CASE service WHEN 'Rank Boost' THEN 'RNK' WHEN 'Placement Boost' THEN 'PLC'
    WHEN 'Win Boost' THEN 'WIN' WHEN 'Pro Duo' THEN 'DUO' ELSE NULL END;
  IF code IS NULL THEN RAISE EXCEPTION 'Unsupported boost type for order number: %', boost_type; END IF;
  RETURN game || '-' || code;
END;
$$;

CREATE FUNCTION fastboost_allocate_order_number(boost_type TEXT) RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  alphabet CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  prefix TEXT := fastboost_order_prefix(boost_type);
  random_bytes BYTEA;
  candidate TEXT;
  reserved TEXT;
BEGIN
  -- UUID bytes 0..4 are cryptographically random (outside version/variant bits).
  -- 32 symbols x 5 gives 33,554,432 suffixes shared across all service prefixes.
  FOR attempt IN 1..1000 LOOP
    random_bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    candidate := '';
    FOR i IN 0..4 LOOP
      candidate := candidate || substr(alphabet, (get_byte(random_bytes, i) & 31) + 1, 1);
    END LOOP;
    INSERT INTO "OrderNumberReservation" ("suffix") VALUES (candidate)
      ON CONFLICT DO NOTHING RETURNING "suffix" INTO reserved;
    IF reserved IS NOT NULL THEN RETURN prefix || '-' || reserved; END IF;
  END LOOP;
  RAISE EXCEPTION 'Unable to allocate a unique order number; retry later';
END;
$$;

UPDATE "Order" SET "orderNumber" = fastboost_allocate_order_number("boostType");
ALTER TABLE "Order" ALTER COLUMN "orderNumber" SET NOT NULL;
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

CREATE FUNCTION fastboost_order_number_trigger() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Always generate on the server; callers cannot choose or reuse a suffix.
    NEW."orderNumber" := fastboost_allocate_order_number(NEW."boostType");
  ELSIF NEW."orderNumber" IS DISTINCT FROM OLD."orderNumber" THEN
    RAISE EXCEPTION 'Order number is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Order_assign_number" BEFORE INSERT OR UPDATE OF "orderNumber" ON "Order"
FOR EACH ROW EXECUTE FUNCTION fastboost_order_number_trigger();

-- Refresh existing machine-generated references without altering chat content.
DO $$
BEGIN
  IF to_regclass('"Notification"') IS NOT NULL THEN
    UPDATE "Notification" n SET
      data = n.data || jsonb_build_object('orderNumber', o."orderNumber", 'shortOrderId', o."orderNumber"),
      message = CASE WHEN n.type::text = 'CHAT_MESSAGE' THEN n.message ELSE
        replace(replace(n.message, '#' || upper(left(o.id,8)), '#' || o."orderNumber"), '#' || left(o.id,8), '#' || o."orderNumber") END
    FROM "Order" o WHERE n.data->>'orderId' = o.id;
  END IF;
  IF to_regclass('"RewardHistory"') IS NOT NULL THEN
    UPDATE "RewardHistory" r SET description = replace(replace(r.description,
      '#' || upper(left(o.id,8)), '#' || o."orderNumber"), '#' || left(o.id,8), '#' || o."orderNumber")
    FROM "Order" o WHERE r."sourceUserId" = o.id AND r.type::text = 'ORDER_REDEMPTION';
  END IF;
END;
$$;
COMMIT;
