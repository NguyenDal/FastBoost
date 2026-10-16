const cardBrands = Object.freeze({ visa: "VISA", mastercard: "Mastercard", amex: "American Express", discover: "Discover", diners: "Diners Club", jcb: "JCB", unionpay: "UnionPay", eftpos_au: "eftpos", cartes_bancaires: "Cartes Bancaires", link: "Link" });
const walletNames = Object.freeze({ apple_pay: "Apple Pay", google_pay: "Google Pay", samsung_pay: "Samsung Pay", link: "Link", amex_express_checkout: "Amex Express Checkout", masterpass: "Masterpass", visa_checkout: "Visa Checkout" });
const methodNames = Object.freeze({ link: "Link", paypal: "PayPal", cashapp: "Cash App Pay", amazon_pay: "Amazon Pay", klarna: "Klarna", affirm: "Affirm", afterpay_clearpay: "Afterpay / Clearpay", us_bank_account: "Bank account", sepa_debit: "SEPA Direct Debit" });
const known = (names, key) => typeof key === "string" && Object.hasOwn(names, key);
const lastFour = value => typeof value === "string" && /^\d{4}$/.test(value) ? value : null;

// Persist only the display-safe parts of Stripe's charge snapshot, never the
// full payment object (billing details, fingerprint, expiry, etc.).
function paymentMethodSnapshot(details) {
    if (!details || typeof details !== "object") return null;
    if (details.type === "card") {
        const card = details.card || {};
        return {
            type: "card",
            brand: known(cardBrands, card.brand) ? card.brand : null,
            last4: lastFour(card.wallet?.dynamic_last4) || lastFour(card.last4),
            wallet: known(walletNames, card.wallet?.type) ? card.wallet.type : null,
        };
    }
    return known(methodNames, details.type) ? { type: details.type } : null;
}

function paymentMethodLabel(method) {
    if (method?.type !== "card") return known(methodNames, method?.type) ? methodNames[method.type] : "Online payment";
    const brand = known(cardBrands, method.brand) ? cardBrands[method.brand] : "Card";
    const wallet = known(walletNames, method.wallet) ? walletNames[method.wallet] : null;
    const last4 = lastFour(method.last4);
    const card = `${brand}${last4 ? ` (•••• ${last4})` : ""}`;
    return wallet && wallet !== brand ? `${wallet} · ${card}` : card;
}

async function retrieveReceiptPaymentMethod(stripe, session) {
    if (!(session.amount_total > 0)) return null;
    try {
        const original = session.payment_intent;
        // Webhooks usually contain the PaymentIntent ID. Reconciliation may
        // already have expanded it, in which case no extra request is needed.
        if (original?.latest_charge?.payment_method_details) {
            return paymentMethodSnapshot(original.latest_charge.payment_method_details);
        }
        const id = typeof original === "string" ? original : original?.id;
        if (!id || !stripe.paymentIntents?.retrieve) return null;
        const intent = await stripe.paymentIntents.retrieve(id, { expand: ["latest_charge"] }, { timeout: 3000, maxNetworkRetries: 0 });
        return paymentMethodSnapshot(intent.latest_charge?.payment_method_details);
    } catch {
        // A receipt detail lookup must never prevent a successful payment from
        // settling. The receipt retains its exact amount with a neutral label.
        return null;
    }
}

module.exports = { paymentMethodSnapshot, paymentMethodLabel, retrieveReceiptPaymentMethod };
