-- A wallet-only checkout reserves funds on Apply, then consumes them only when
-- the customer explicitly pays. It has no payable Stripe session to recover.
ALTER TABLE "WalletCheckoutHold"
  DROP CONSTRAINT "WalletCheckoutHold_quote_check",
  ADD CONSTRAINT "WalletCheckoutHold_quote_check" CHECK (
    "cashAmountCents" > 0 AND "orderAmountCents" > 0 AND
    ("cashAmountCents" = "amountCents" OR "cashAmountCents"::BIGINT - "amountCents"::BIGINT >= 50) AND
    "goldDiscountCents" >= 0 AND ("goldRedeemed" = 0 OR "goldRedeemed" >= 100) AND
    "goldDiscountCents"::BIGINT = "goldRedeemed"::BIGINT * 10 AND
    "orderAmountCents"::BIGINT - "goldDiscountCents"::BIGINT = "cashAmountCents"::BIGINT
  ),
  ADD CONSTRAINT "WalletCheckoutHold_mode_check" CHECK (
    CASE WHEN "cashAmountCents" = "amountCents"
      THEN "stripeCheckoutSessionId" IS NULL AND COALESCE("stripeParametersJson" -> 'walletOnly' = 'true'::JSONB, FALSE)
      ELSE "stripeParametersJson" -> 'walletOnly' IS DISTINCT FROM 'true'::JSONB
    END
  );
