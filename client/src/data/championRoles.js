export const roleNames = ["Top", "Jungle", "Middle", "Bottom", "Support"];

export const roleIconMap = {
  Top: "/assets/roles/top.png",
  Jungle: "/assets/roles/jungle.png",
  Middle: "/assets/roles/mid.png",
  Bottom: "/assets/roles/bot.png",
  Support: "/assets/roles/support.png",
  Fill: "/assets/roles/fill.png",
};

export function getSecondRoleOptions(firstRole) {
  const selectedRole = roleNames.includes(firstRole) ? firstRole : "Top";
  return ["Fill", ...roleNames.filter((role) => role !== selectedRole)];
}
