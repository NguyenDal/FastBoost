const riotBasics = { label: 'Riot Games · How to play', url: 'https://www.leagueoflegends.com/en-us/how-to-play/' };
const waveGuide = { label: 'Mobalytics · Wave management', url: 'https://mobalytics.gg/lol/guides/wave-management' };

export const roleGuides = [
  {
    slug: 'top',
    title: 'Top lane',
    shortTitle: 'Top',
    image: '/assets/roles/top.png',
    tagline: 'Own your lane. Choose your moments.',
    goal: 'Keep your solo lane productive and safe, then turn wave pressure into useful team presence.',
    fundamentals: [
      { title: 'Protect your farm', body: 'Last-hit consistently. In a difficult matchup, let the wave stay closer to your side so you can collect minions without walking far into danger.' },
      { title: 'Trade with a reason', body: 'Watch the enemy’s key abilities and the size of their minion wave. Trade when they cannot answer well, rather than fighting inside a large wave.' },
      { title: 'Make pressure travel', body: 'Before extending or rotating, locate the enemy jungler and set your wave. A pushed wave can make the opponent choose between defending and following you.' },
    ],
    mapNotes: {
      top: { title: 'Top lane', body: 'Control the wave before committing to a trade.' },
      jungle: { title: 'Jungle approach', body: 'Track the unseen jungler before extending.' },
      river: { title: 'River route', body: 'Push first, then take a safe rotation.' },
      objective: { title: 'Team objective', body: 'Make your opponent answer the wave before you move.' },
    },
    scenarios: [
      {
        title: 'Play the weak side',
        prompt: 'You are in a weak matchup. The enemy wave approaches your turret, and the enemy jungler is missing. What is the best move?',
        mapFocus: 'top',
        correctIndex: 0,
        choices: [
          { text: 'Last-hit safely, keep the wave near your side, and ward before stepping forward.', feedback: 'This protects farm and reduces your exposure to a gank.' },
          { text: 'Spend abilities to shove past the river.', feedback: 'That leaves you extended without knowing where the enemy jungler is.' },
          { text: 'Follow your opponent into the unwarded river.', feedback: 'Walking into fog of war gives away your safe lane position for an uncertain play.' },
        ],
      },
      {
        title: 'Create a rotation window',
        prompt: 'Your opponent recalls. A team objective will soon be contested, and the waves meet in top lane. What should you do first?',
        mapFocus: 'objective',
        correctIndex: 0,
        choices: [
          { text: 'Push the wave into the enemy turret, then rotate if the route is safe.', feedback: 'The opponent must answer the wave or give up resources, giving you time to move.' },
          { text: 'Leave immediately and give up the wave.', feedback: 'You miss free farm and give the opponent an easier lane to return to.' },
          { text: 'Freeze near your turret while your team gathers.', feedback: 'A freeze keeps you tied to lane when your team needs a nearby numbers advantage.' },
        ],
      },
    ],
    practice: [
      'Last-hit without pushing the wave unnecessarily.',
      'Before a trade, check enemy cooldowns and minion-wave size.',
      'Before extending or rotating, find the enemy jungler and set the wave.',
    ],
    sources: [riotBasics, { label: 'Mobalytics · Top lane skills', url: 'https://mobalytics.gg/lol/guides/skills-to-master-for-top' }, waveGuide],
  },
  {
    slug: 'jungle',
    title: 'Jungle',
    shortTitle: 'Jungle',
    image: '/assets/roles/jungle.png',
    tagline: 'Path with purpose. Arrive with a plan.',
    goal: 'Build strength through efficient camps while choosing ganks and neutral objectives your team can secure.',
    fundamentals: [
      { title: 'Plan while clearing', body: 'Know the next camp or lane you want to visit before finishing the current camp. Scan lane positions while farming.' },
      { title: 'Gank the opening', body: 'Look for enemies your allies can reach and help finish. Avoid forcing a healthy enemy under their turret when a camp or better lane is available.' },
      { title: 'Earn the objective', body: 'Track the enemy jungler, nearby allies, and vision. An objective is easier to secure when your team can move first and contest safely.' },
    ],
    mapNotes: {
      jungle: { title: 'Camp route', body: 'Farm with a plan for your next move.' },
      top: { title: 'Top approach', body: 'Check the wave and ally follow-up before ganking.' },
      bot: { title: 'Bot approach', body: 'A winning bot lane may move with you toward an objective.' },
      river: { title: 'River information', body: 'Vision and enemy position decide whether the route is safe.' },
      objective: { title: 'Neutral objective', body: 'Check allies, vision, and who can contest.' },
    },
    scenarios: [
      {
        title: 'Do not force a dive',
        prompt: 'You finish a top-side camp. Your top laner has pushed a healthy enemy under their turret, and another camp is available. What next?',
        mapFocus: 'top',
        correctIndex: 2,
        choices: [
          { text: 'Force a turret dive.', feedback: 'A healthy defender under turret makes this an unnecessary risk.' },
          { text: 'Wait in top brush until something happens.', feedback: 'Waiting without an opening burns time you could spend farming or moving.' },
          { text: 'Take the camp, reassess the map, and path toward a reachable lane.', feedback: 'You maintain income and can arrive where a real gank window exists.' },
        ],
      },
      {
        title: 'Use the numbers advantage',
        prompt: 'A neutral objective is available. The enemy jungler is visible top; your bot lane just won a fight and can move with you. You are healthy. What is the best call?',
        mapFocus: 'objective',
        correctIndex: 0,
        choices: [
          { text: 'Ping your team, check nearby vision, and take the objective together.', feedback: 'Your nearby allies and the distant enemy jungler create a strong opening, provided other enemies cannot contest.' },
          { text: 'Invade the enemy top jungle alone.', feedback: 'That abandons a supported team objective for a long, risky solo move.' },
          { text: 'Recall without using the opening.', feedback: 'You give up a temporary advantage while your team is ready to move.' },
        ],
      },
    ],
    practice: [
      'Plan your next camp or gank before finishing the current camp.',
      'Scan lane position and ally health while clearing.',
      'Before an objective, verify enemy jungler position, allies, and vision.',
    ],
    sources: [riotBasics, { label: 'Mobalytics · Jungling from low ranks', url: 'https://mobalytics.gg/lol/guides/how-to-climb-low-elo-jungler' }, { label: 'Mobalytics · Gank setup', url: 'https://mobalytics.gg/lol/guides/gank-setup' }, { label: 'Mobalytics · Map awareness', url: 'https://mobalytics.gg/lol/guides/improve-map-awareness' }],
  },
  {
    slug: 'mid',
    title: 'Mid lane',
    shortTitle: 'Mid',
    image: '/assets/roles/mid.png',
    tagline: 'Control the wave. Influence the map.',
    goal: 'Turn solo-lane farm and wave control into safe influence on nearby fights and objectives.',
    fundamentals: [
      { title: 'Farm and trade', body: 'Last-hit first. Look for a trade when the opponent commits to a minion, while preserving enough health and abilities to answer a skirmish.' },
      { title: 'Read both sides', body: 'Check missing players and the river before leaving lane. Wards and pings let you and your teammates act on the same information.' },
      { title: 'Push, then move', body: 'Crash your wave before a roam when possible. Check that the destination is reachable and your allies have health and abilities to follow up.' },
    ],
    mapNotes: {
      mid: { title: 'Mid wave', body: 'Push the wave to buy time for a roam.' },
      river: { title: 'River crossing', body: 'Use vision and pings before crossing.' },
      bot: { title: 'Bot lane roam', body: 'Look for extended enemies and allies who can follow.' },
      objective: { title: 'Objective access', body: 'Mid pressure helps your team enter river first.' },
    },
    scenarios: [
      {
        title: 'A useful roam',
        prompt: 'Your wave is under the enemy mid turret. Your healthy bot pair faces an overextended enemy duo; your ward shows a safe river route, and your jungler is nearby. What is the best move?',
        mapFocus: 'bot',
        correctIndex: 0,
        choices: [
          { text: 'Ping and roam bot by the warded route, then return for the next wave.', feedback: 'The wave is secured and nearby allies can turn the roam into a numbers advantage.' },
          { text: 'Stay alone hitting the mid turret while your opponent returns.', feedback: 'You miss a clear team opening and risk overextending as the enemy mid returns.' },
          { text: 'Cut through the unwarded enemy jungle.', feedback: 'An unwarded shortcut adds an avoidable ambush risk.' },
        ],
      },
      {
        title: 'A missing opponent',
        prompt: 'Enemy mid disappears toward bot. A wave is arriving at your turret, and you have no river vision. What now?',
        mapFocus: 'mid',
        correctIndex: 1,
        choices: [
          { text: 'Chase blindly through the river.', feedback: 'You may be ambushed and will lose the wave crashing at your turret.' },
          { text: 'Ping missing and danger, collect the wave, then move if a safe route or fight opens.', feedback: 'You warn teammates without giving up free resources for an uncertain chase.' },
          { text: 'Farm without warning anyone.', feedback: 'Your bot lane loses vital information about the missing enemy.' },
        ],
      },
    ],
    practice: [
      'Mark the enemy mid laner’s last known position each wave.',
      'Check your wave state before every roam.',
      'Ping your route and intended play before leaving lane.',
    ],
    sources: [riotBasics, { label: 'Mobalytics · Mid map impact', url: 'https://mobalytics.gg/lol/guides/4-tips-to-impact-the-map-as-the-mid-laner' }, waveGuide],
  },
  {
    slug: 'bot',
    title: 'Bot lane / ADC',
    shortTitle: 'Bot / ADC',
    image: '/assets/roles/bot.png',
    tagline: 'Keep earning. Keep dealing damage.',
    goal: 'Collect reliable gold and deal sustained fight damage while staying alive with your team.',
    fundamentals: [
      { title: 'Secure the wave', body: 'Practice last-hitting and recognize when to push or let the wave come closer. Missing one dangerous minion is better than losing your life.' },
      { title: 'Play as a pair', body: 'Check your support’s position before stepping up. Avoid trading one against two while your partner is gone or unable to follow.' },
      { title: 'Damage from safety', body: 'In teamfights, start with the nearest target you can hit safely. Keep distance from the enemy’s engage and move with your team.' },
    ],
    mapNotes: {
      bot: { title: 'Bot wave', body: 'When alone, let dangerous waves reach a safer position.' },
      river: { title: 'River threat', body: 'Dark river limits how far you can step up.' },
      mid: { title: 'Move with allies', body: 'Reach fights with teammates, not through isolated paths.' },
      objective: { title: 'Objective fight', body: 'Stay near allies and hit the nearest safe target.' },
    },
    scenarios: [
      {
        title: 'Farm without your support',
        prompt: 'Your support has recalled. Both enemy laners are present with their engage ready, and their wave is moving toward your turret. What should you do?',
        mapFocus: 'bot',
        correctIndex: 1,
        choices: [
          { text: 'Walk up for every minion.', feedback: 'One last hit is not worth being caught by two opponents.' },
          { text: 'Stay in safe experience range and collect reachable last hits as the wave reaches you.', feedback: 'You preserve health and experience while the wave moves to a safer position.' },
          { text: 'Shove alone into the enemy duo.', feedback: 'Pushing forward alone exposes you far from safety.' },
        ],
      },
      {
        title: 'The first teamfight target',
        prompt: 'A teamfight starts. The enemy diver still has an engage ability; an enemy frontline champion is in safe attack range, with their carry behind. What is your first move?',
        mapFocus: 'objective',
        correctIndex: 1,
        choices: [
          { text: 'Run past the frontline to reach their carry.', feedback: 'That puts you inside the diver’s engage range before you can deal sustained damage.' },
          { text: 'Stay with allies, move between attacks, and hit the nearest safe target.', feedback: 'You keep damage flowing while remaining harder to catch.' },
          { text: 'Stand so far back that you cannot attack anyone.', feedback: 'You give up your main contribution to the fight.' },
        ],
      },
    ],
    practice: [
      'Review missed last hits after lane phase.',
      'Glance at your support before stepping up.',
      'Before a fight, identify the enemy engage threat and your safe first target.',
    ],
    sources: [riotBasics, { label: 'Mobalytics · ADC fundamentals', url: 'https://mobalytics.gg/lol/guides/carry-as-adc' }, { label: 'Mobalytics · Teamfight positioning', url: 'https://mobalytics.gg/lol/guides/everything-you-need-to-know-about-team-comps-and-teamfighting' }],
  },
  {
    slug: 'support',
    title: 'Support',
    shortTitle: 'Support',
    image: '/assets/roles/support.png',
    tagline: 'Create space. See the next play.',
    goal: 'Keep allies able to farm and fight, then create map advantage through pressure, vision, and well-timed movement.',
    fundamentals: [
      { title: 'Share lane pressure', body: 'Stand close enough to help your ADC farm and trade, but adjust your angle and distance when enemy engage is ready.' },
      { title: 'Make vision safe', body: 'Place and clear wards around likely routes and objectives. Go with an ally or through a known safe path instead of walking alone into fog.' },
      { title: 'Roam with a window', body: 'Leave lane when your ADC can farm safely or has recalled, and when the destination has an ally who can follow your play.' },
    ],
    mapNotes: {
      bot: { title: 'Lane partnership', body: 'Stay close enough to help your ADC farm.' },
      river: { title: 'Vision line', body: 'Ward likely routes without entering fog alone.' },
      mid: { title: 'Mid roam', body: 'Roam when your ADC is safe and mid can follow up.' },
      objective: { title: 'Objective setup', body: 'Move with your team to set safe vision.' },
    },
    scenarios: [
      {
        title: 'Position for your partner',
        prompt: 'Your ADC steps up for a minion while the enemy engage support holds their main catch ability. Where should you stand?',
        mapFocus: 'bot',
        correctIndex: 0,
        choices: [
          { text: 'Near your ADC, offset from the engage angle, ready to peel or trade.', feedback: 'You support the farm attempt without offering the enemy a free catch.' },
          { text: 'Far behind your ADC.', feedback: 'That turns your partner’s farm attempt into a one-versus-two situation.' },
          { text: 'Alone deep in enemy space.', feedback: 'You become an isolated target for the enemy engage.' },
        ],
      },
      {
        title: 'Choose a roam window',
        prompt: 'You crash the bot wave into the enemy turret, and your ADC recalls. Enemy mid is pushed up, your health is good, and your route is warded. What next?',
        mapFocus: 'mid',
        correctIndex: 0,
        choices: [
          { text: 'Ping a brief mid roam, use the safe route, and return before your ADC needs you.', feedback: 'You use a real roam window without abandoning your carry in danger.' },
          { text: 'Stay bot to take the next wave’s farm.', feedback: 'You take carry resources and miss the useful, safe window.' },
          { text: 'Enter the unwarded enemy jungle alone for a deep ward.', feedback: 'A speculative ward does not justify the risk of being caught alone.' },
        ],
      },
    ],
    practice: [
      'Compare your lane position with your ADC before each trade.',
      'Ward with a teammate or along a known safe route.',
      'Before roaming, check whether your ADC stays safe and your target can follow up.',
    ],
    sources: [{ label: 'Mobalytics · Support positioning', url: 'https://mobalytics.gg/lol/guides/how-to-position-support-lane' }, { label: 'Mobalytics · Support roaming', url: 'https://mobalytics.gg/lol/guides/roaming-support' }, { label: 'Mobalytics · Support map impact', url: 'https://mobalytics.gg/lol/guides/5-tips-to-impact-the-map-as-support' }],
  },
];

export const roleGuidesBySlug = Object.fromEntries(roleGuides.map(role => [role.slug, role]));
