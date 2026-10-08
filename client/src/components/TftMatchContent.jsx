import { useEffect, useState } from 'react';
import '../styles/TftMatchContent.css';

const cache = new Map();
const cleanName = id => String(id || '').replace(/^(?:TFT|Set)\d*_?(?:Item_)?/i, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
function useTftAssets(patch) {
    const [assets, setAssets] = useState(null);
    useEffect(() => {
        let active = true;
        if (!cache.has(patch)) {
            cache.set(patch, fetch('https://ddragon.leagueoflegends.com/api/versions.json').then(r => r.json()).then(async versions => {
                const version = versions.find(v => v.startsWith(`${patch}.`)) || versions[0];
                const base = `https://ddragon.leagueoflegends.com/cdn/${version}`;
                const kinds = ['champion', 'trait', 'item'];
                const rows = await Promise.all(kinds.map(kind => fetch(`${base}/data/en_US/tft-${kind}.json`).then(r => r.ok ? r.json() : { data: {} })));
                return { base, ...Object.fromEntries(kinds.map((kind, i) => [kind, rows[i].data || {}])) };
            }).catch(() => { cache.delete(patch); return null; }));
        }
        cache.get(patch).then(value => { if (active) setAssets(value); });
        return () => { active = false; };
    }, [patch]);
    return assets;
}
function TftIcon({ id, kind, assets, fallback }) {
    const [failed, setFailed] = useState(false);
    const asset = assets?.[kind]?.[id];
    const name = asset?.name || fallback || cleanName(id);
    return asset?.image?.full && !failed ? <img src={`${assets.base}/img/tft-${kind}/${asset.image.full}`} alt={name} title={name} loading="lazy" onError={() => setFailed(true)} /> : <span title={name}>{name.slice(0, 2)}</span>;
}
function Board({ player, assets }) {
    return <div className="mh-tft-board" aria-label="Final board">{player.units.map((unit, i) => <div className="mh-tft-unit" key={`${unit.id}-${i}`} title={`${assets?.champion?.[unit.id]?.name || unit.name || cleanName(unit.id)} · ${unit.tier} stars`}>
        <small aria-label={`${unit.tier} stars`}>{'★'.repeat(unit.tier)}</small>
        <div className="mh-tft-portrait"><TftIcon id={unit.id} kind="champion" assets={assets} fallback={unit.name} /></div>
        <div className="mh-tft-items">{unit.items.map((item, index) => <TftIcon key={index} id={item} kind="item" assets={assets} />)}</div>
    </div>)}</div>;
}
function Traits({ player, assets }) {
    return <div className="mh-tft-traits" aria-label="Active traits">{player.traits.filter(t => t.tier > 0).map(trait => <span key={trait.id} title={assets?.trait?.[trait.id]?.name || cleanName(trait.id)}><TftIcon id={trait.id} kind="trait" assets={assets} /><b>{trait.units}</b><span>{assets?.trait?.[trait.id]?.name || cleanName(trait.id)}</span></span>)}</div>;
}
export function TftMatchSummary({ match, timeLabel }) {
    const { details } = match;
    const player = details.players[details.selected];
    const assets = useTftAssets(details.version);
    return <div className="mh-tft-summary">
        <div className="mh-result"><strong className="mh-queue">Ranked TFT</strong><time dateTime={match.playedAt} title={new Date(match.playedAt).toLocaleString()}>{timeLabel}</time><strong className="mh-outcome">#{player.placement} · {player.placement === 1 ? 'Victory' : player.win ? 'Top 4' : 'Defeat'}</strong><small>{Math.floor(details.duration / 60)}m {String(details.duration % 60).padStart(2, '0')}s</small>{match.booster && <small>{match.booster.username}</small>}</div>
        <div className="mh-tft-build"><Traits player={player} assets={assets} /><Board player={player} assets={assets} /></div>
        <dl className="mh-stats"><div><dt>Level</dt><dd>{player.level}</dd></div><div><dt>Player damage</dt><dd>{player.damage}</dd></div><div><dt>Gold left</dt><dd>{player.goldLeft}</dd></div></dl>
    </div>;
}
export function TftScoreboard({ match }) {
    const assets = useTftAssets(match.details.version);
    return <div className="mh-scoreboards"><div className="mh-scoreboard-wrap"><table className="mh-scoreboard mh-tft-scoreboard"><caption className="mh-sr-only">Ranked TFT placements and final boards</caption><thead><tr><th>Place</th><th>Player</th><th>Level</th><th>Damage</th><th>Final board</th></tr></thead><tbody>{match.details.players.map((player, index) => ({ ...player, index })).sort((a, b) => a.placement - b.placement).map(player => <tr key={player.index} className={player.index === match.details.selected ? 'mh-selected' : ''}>
        <td>#{player.placement}</td><td><strong>{player.name}{player.tag && `#${player.tag}`}</strong><Traits player={player} assets={assets} /></td><td>{player.level}</td><td>{player.damage}</td><td><Board player={player} assets={assets} /></td>
    </tr>)}</tbody></table></div></div>;
}
