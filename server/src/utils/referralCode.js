function generateReferralCode(username = "") {
  const cleanName = String(username || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 4)
    .toUpperCase();

  const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();

  return `${cleanName || "FB"}${randomPart}`;
}

module.exports = {
  generateReferralCode,
};