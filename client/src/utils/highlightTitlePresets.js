export const HIGHLIGHT_TITLE_GROUPS = {
  lol: [
    { label: 'Kills', options: ['First Blood', 'Solo Kill', 'Double Kill', 'Triple Kill', 'Quadra Kill', 'Pentakill', 'Shutdown', 'Ace'] },
    { label: 'Outplays & fights', options: ['1v2+ Outplay', 'Teamfight Win', 'Wombo Combo', 'Clutch Save', 'Clutch Escape', 'Gank', 'Countergank'] },
    { label: 'Objectives', options: ['Dragon Secure', 'Dragon Steal', 'Elder Dragon Secure', 'Elder Dragon Steal', 'Baron Secure', 'Baron Steal', 'Rift Herald Secure', 'Rift Herald Steal', 'Void Grubs Secure', 'Void Grubs Steal', 'Dragon Soul', 'Objective Steal'] },
    { label: 'Map & finish', options: ['First Turret', 'Tower Dive', 'Inhibitor', 'Base Defense', 'Backdoor', 'Final Push', 'Nexus Win'] },
  ],
  tft: [
    { label: 'Results', options: ['First Place', 'Top Four', 'Clutch Final Round', 'Comeback', 'Perfect Game'] },
    { label: 'Board', options: ['3-Star Unit', 'Trait Power Spike', 'Board Pivot', 'Item Spike', 'Final Board'] },
    { label: 'Economy', options: ['Win Streak', 'Loss-streak Cashout', 'Clutch Roll'] },
  ],
};

export function isHighlightTitlePreset(gameMode, title) {
  const groups = HIGHLIGHT_TITLE_GROUPS[gameMode === 'tft' ? 'tft' : 'lol'];
  return groups.some(group => group.options.includes(title));
}
