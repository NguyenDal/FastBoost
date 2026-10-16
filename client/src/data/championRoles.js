export const roleNames = ["Top", "Jungle", "Middle", "Bottom", "Support"];

export const roleIconMap = {
  Top: "https://fastboost-assets.s3.amazonaws.com/roles/top.png",
  Jungle: "https://fastboost-assets.s3.amazonaws.com/roles/jungle.png",
  Middle: "https://fastboost-assets.s3.amazonaws.com/roles/mid.png",
  Bottom: "https://fastboost-assets.s3.amazonaws.com/roles/bot.png",
  Support: "https://fastboost-assets.s3.amazonaws.com/roles/support.png",
  Fill: "https://fastboost-assets.s3.amazonaws.com/roles/fill.png",
};

export function getSecondRoleOptions(firstRole) {
  const selectedRole = roleNames.includes(firstRole) ? firstRole : "Top";
  return ["Fill", ...roleNames.filter((role) => role !== selectedRole)];
}
