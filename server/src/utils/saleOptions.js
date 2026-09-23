function saleOptions(body) {
    const mode = body.saleMode || "WITHOUT_COUPON";
    if (!["WITH_COUPON", "WITHOUT_COUPON"].includes(mode)) throw new Error("Choose with coupon or without coupon.");
    const couponCode = mode === "WITH_COUPON" ? String(body.couponCode || "").trim().toUpperCase() : null;
    if (mode === "WITH_COUPON" && !/^[A-Z0-9][A-Z0-9-]{3,31}$/.test(couponCode)) throw new Error("Enter a coupon code of 4–32 letters, numbers or hyphens.");
    const date = value => {
        if (!value) return null;
        const parsed = new Date(value);
        if (!Number.isFinite(parsed.getTime())) throw new Error("Enter valid sale dates.");
        return parsed;
    };
    const startsAt = date(body.startsAt);
    const endsAt = date(body.endsAt);
    if (!couponCode && !endsAt) throw new Error("Set Sale End for a sale without a coupon.");
    if (endsAt && endsAt <= (startsAt || new Date())) throw new Error("Sale end must be after sale start and in the future.");
    return { couponCode, footerDecoration: body.footerDecoration === true, footerTimer: body.footerTimer !== false, startsAt, endsAt, appliesTo: "BASE_PRICE" };
}
module.exports = { saleOptions };
