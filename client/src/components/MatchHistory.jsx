import { useEffect, useRef, useState } from 'react';
import { operations, money } from '../api/operations';
import OrderPagination from './OrderPagination';
import '../styles/MatchHistory.css';

const assetCache = new Map();
let versionsPromise;
function assetsFor(patch) {
    if (!assetCache.has(patch)) {
        const request = (versionsPromise ||= fetch('https://ddragon.leagueoflegends.com/api/versions.json').then(r => r.json()))
            .then(async versions => {
                const version = versions.find(v => v.startsWith(`${patch}.`)) || versions[0];
                const base = `https://ddragon.leagueoflegends.com/cdn/${version}`;
                const [champions, items, spells, runeStyles] = await Promise.all(['champion', 'item', 'summoner', 'runesReforged'].map(kind => fetch(`${base}/data/en_US/${kind}.json`).then(r => r.json())));
                return { base, champions: Object.fromEntries(Object.values(champions.data).map(c => [c.key, c])), items: items.data,
                    spells: Object.fromEntries(Object.values(spells.data).map(s => [s.key, s])),
                    runes: Object.fromEntries(runeStyles.flatMap(s => [s, ...s.slots.flatMap(slot => slot.runes)]).map(r => [r.id, r])) };
            }).catch(() => { assetCache.delete(patch); versionsPromise = undefined; return null; });
        assetCache.set(patch, request);
    }
    return assetCache.get(patch);
}
function useAssets(patch) {
    const [assets, setAssets] = useState(null);
    useEffect(() => { let active = true; assetsFor(patch).then(value => { if (active) setAssets(value); }); return () => { active = false; }; }, [patch]);
    return assets;
}
function Items({ items, assets }) {
    return <div className="mh-items" aria-label="Final item build">{items.map((id, slot) => {
        const item = assets?.items[id];
        const label = id ? item?.name || `Item ${id}` : 'Empty slot';
        return <span key={slot} className={`mh-item ${slot === 6 ? 'mh-trinket' : ''}`} title={label}>
            {item ? <img src={`${assets.base}/img/item/${id}.png`} alt={label} loading="lazy" /> : <span aria-label={label}>{id || ''}</span>}
        </span>;
    })}</div>;
}
function Champion({ player, assets, compact = false }) {
    const champion = assets?.champions[player.championId];
    return <span className={`mh-champion${compact ? ' mh-champion-mini' : ''}`}>{champion ? <img src={`${assets.base}/img/champion/${champion.image.full}`} alt={champion.name} loading="lazy" /> : <span>{player.champion.slice(0, 2)}</span>}{!compact && <small>{player.level}</small>}</span>;
}
function Loadout({ player, assets }) {
    return <div className="mh-loadout" title={playerName(player)}>
        <Champion player={player} assets={assets} />
        <div className="mh-spells" aria-label="Summoner spells">{(player.summonerSpells || [0, 0]).map((id, index) => {
            const spell = assets?.spells[id];
            return <span key={index} title={spell?.name || 'Summoner spell unavailable'}>{spell ? <img src={`${assets.base}/img/spell/${spell.image.full}`} alt={spell.name} loading="lazy" /> : <span aria-label="Summoner spell unavailable">–</span>}</span>;
        })}</div>
        <div className="mh-runes" aria-label="Runes">{(player.runes || [0, 0]).map((id, index) => {
            const rune = assets?.runes[id];
            return <span key={index} title={rune?.name || 'Rune unavailable'}>{rune ? <img src={`https://ddragon.leagueoflegends.com/cdn/img/${rune.icon}`} alt={rune.name} loading="lazy" /> : <span aria-label="Rune unavailable">–</span>}</span>;
        })}</div>
    </div>;
}
const queues = { 400: 'Normal draft', 420: 'Ranked Solo/Duo', 430: 'Normal blind', 440: 'Ranked Flex', 450: 'ARAM', 490: 'Quickplay', 1700: 'Arena' };
const duration = seconds => `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
const statusLabel = match => match.status === 'PENDING' ? (match.boosterId ? 'Submitted' : 'Not submitted') : match.status === 'APPROVED' ? 'Approved' : 'Excluded';
const selectable = match => match.status === 'PENDING' && !match.boosterId;
const PAGE_SIZE = 5;
const playerName = player => `${player.name}${player.tag ? `#${player.tag}` : ''}`;
const kda = player => player.deaths ? `${((player.kills + player.assists) / player.deaths).toFixed(2)}:1` : 'Perfect';
const csPerMinute = (player, seconds) => seconds > 0 ? (player.cs / (seconds / 60)).toFixed(1) : '—';
const compactNumber = value => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
function relativeTime(value, now) {
    const seconds = Math.max(0, (now - new Date(value).getTime()) / 1000);
    if (seconds < 60) return 'Just now';
    const [size, unit] = seconds < 3600 ? [60, 'minute'] : seconds < 86400 ? [3600, 'hour'] : seconds < 2592000 ? [86400, 'day'] : seconds < 31536000 ? [2592000, 'month'] : [31536000, 'year'];
    const count = Math.floor(seconds / size);
    return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}
function Chevron() {
    return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>;
}
function Roster({ teams, selected, assets }) {
    return <div className="mh-rosters">{teams.map(team => <div className={`mh-roster mh-team-${team.win ? 'win' : 'loss'}`} key={team.id}>
        <span className="mh-roster-label">{team.ours ? 'Our team' : 'Enemy team'}</span>
        <ul>{team.players.map(p => <li key={p.index} className={p.index === selected ? 'mh-roster-selected' : ''} title={playerName(p)}><Champion player={p} assets={assets} compact /><span>{p.name}</span></li>)}</ul>
    </div>)}</div>;
}
function Rank({ rank, loading, queueId, checkedAt }) {
    const tier = rank?.unranked ? 'unranked' : rank?.tier?.toLowerCase();
    const division = { I: 1, II: 2, III: 3, IV: 4 }[rank?.division];
    const label = rank?.unranked ? 'Unranked' : tier ? `${tier[0].toUpperCase()}${tier.slice(1)}${division && !['master', 'grandmaster', 'challenger'].includes(tier) ? ` ${division}` : ''}` : loading ? 'Loading rank…' : 'Rank unavailable';
    return <small className={`mh-rank mh-rank-${tier || 'unknown'}`} title={`Current ${queues[queueId] || 'ranked'} rank${checkedAt ? ` · checked ${new Date(checkedAt).toLocaleString()}` : ''}${rank?.lp !== undefined ? ` · ${rank.lp} LP` : ''}`}>
        {tier && <img src={`https://fastboost-assets.s3.amazonaws.com/services/ranks/${tier}.${tier === 'unranked' ? 'webp' : 'png'}`} alt="" loading="lazy" />}{label}
    </small>;
}
function Scoreboard({ match, teams, assets, path }) {
    const [ranks, setRanks] = useState(null);
    useEffect(() => {
        let active = true;
        operations(`${path}/${match.id}/player-details`).then(result => { if (active) setRanks(result); }).catch(() => { if (active) setRanks({ ranks: [] }); });
        return () => { active = false; };
    }, [path, match.id]);
    const maxDamage = Math.max(1, ...match.details.players.map(p => p.damage));
    const takenByPlayer = match.details.players.map((p, index) => p.damageTaken ?? ranks?.damageTaken?.[index]);
    const maxTaken = Math.max(1, ...takenByPlayer.filter(Number.isFinite));
    return <div className="mh-scoreboards">{teams.map(team => <section key={team.id} className={`mh-team mh-team-${team.win ? 'win' : 'loss'}`} aria-label={team.ours ? 'Our team scoreboard' : 'Enemy team scoreboard'}>
        <header className="mh-team-heading">
            <div><h3>{team.ours ? 'Our team' : 'Enemy team'}</h3><span className="mh-team-side">{team.id === 100 ? 'Blue' : 'Red'} side</span><strong className={team.win ? 'mh-victory' : 'mh-defeat'}>{match.details.remake ? 'Remake' : team.win ? 'Victory' : 'Defeat'}</strong></div>
            <div className="mh-team-totals"><span><strong>{team.kills}</strong> kills</span><span><strong>{compactNumber(team.gold)}</strong> gold</span></div>
        </header>
        <div className="mh-scoreboard-wrap" tabIndex={0} role="region" aria-label={`${team.ours ? 'Our' : 'Enemy'} team match statistics`}><table className="mh-scoreboard">
            <caption className="mh-sr-only">{match.externalId} · {team.ours ? 'Our team' : 'Enemy team'} scoreboard</caption>
            <thead><tr><th scope="col">Player <span className="mh-rank-caption">· current rank</span></th><th scope="col">K / D / A</th><th scope="col">CS</th><th scope="col">Damage</th><th scope="col">Vision</th><th scope="col">Items</th></tr></thead>
            <tbody>{team.players.map(p => <tr key={p.index} className={p.index === match.details.selected ? 'mh-selected' : ''}>
                <th scope="row"><div className="mh-player mh-player-loadout"><Loadout player={p} assets={assets} /><span><strong title={playerName(p)}>{p.name}</strong><Rank rank={ranks?.ranks[p.index]} loading={!ranks} queueId={match.details.queueId} checkedAt={ranks?.checkedAt} /></span></div></th>
                <td><strong>{p.kills} / <span className="mh-deaths">{p.deaths}</span> / {p.assists}</strong><small>{kda(p)} KDA</small></td>
                <td>{p.cs}<small>{csPerMinute(p, match.details.duration)} / min</small></td>
                <td><div className="mh-damage-pair"><span className="mh-damage" title="Damage dealt to champions">{p.damage.toLocaleString()}<span className="mh-damage-track" aria-hidden="true"><span style={{ width: `${p.damage / maxDamage * 100}%` }} /></span></span><span className="mh-damage mh-damage-taken" title="Total damage taken">{Number.isFinite(takenByPlayer[p.index]) ? takenByPlayer[p.index].toLocaleString() : '—'}<span className="mh-damage-track" aria-hidden="true"><span style={{ width: `${(takenByPlayer[p.index] || 0) / maxTaken * 100}%` }} /></span></span></div></td>
                <td>{p.vision}</td><td><Items items={p.items} assets={assets} /></td>
            </tr>)}</tbody>
        </table></div>
    </section>)}</div>;
}

function MatchCard({ match, boosters, canReview, canSelect, checked, onSelect, busy, onReview, now, path }) {
    const { details } = match;
    const player = details.players[details.selected];
    const assets = useAssets(details.version);
    const [boosterId, setBoosterId] = useState(match.boosterId || '');
    const [note, setNote] = useState(match.reviews?.[0]?.note || '');
    const [expanded, setExpanded] = useState(false);
    const [hasExpanded, setHasExpanded] = useState(false);
    const result = details.remake ? 'Remake' : player.win ? 'Victory' : 'Defeat';
    const teams = [...new Set(details.players.map(p => p.team))]
        .sort((a, b) => Number(b === player.team) - Number(a === player.team))
        .map(id => {
            const players = details.players.map((p, index) => ({ ...p, index })).filter(p => p.team === id);
            return { id, players, ours: id === player.team, win: players[0].win, kills: players.reduce((sum, p) => sum + p.kills, 0), gold: players.reduce((sum, p) => sum + p.gold, 0) };
        });
    const teamKills = teams[0].kills;
    const participation = teamKills ? Math.round((player.kills + player.assists) / teamKills * 100) : 0;
    const detailsId = `match-details-${match.id}`;
    return <article className={`mh-card ${player.win ? 'mh-win' : 'mh-loss'}${checked ? ' mh-checked' : ''}`}>
        <div className="mh-overview">
            <div className="mh-match-summary">
                <div className="mh-result"><strong className="mh-queue">{queues[details.queueId] || details.mode}</strong><time dateTime={match.playedAt} title={new Date(match.playedAt).toLocaleString()}>{relativeTime(match.playedAt, now)}</time><strong className="mh-outcome">{result}</strong><small>{duration(details.duration)}</small>{canSelect && <label className="mh-pick"><input type="checkbox" checked={checked} disabled={busy} onChange={onSelect} aria-label={`I played ${match.externalId}`} />I played this</label>}</div>
                <div className="mh-build"><Loadout player={player} assets={assets} /><Items items={player.items} assets={assets} /></div>
                <div className="mh-score"><strong>{player.kills} <span className="mh-slash">/</span> <span className="mh-deaths">{player.deaths}</span> <span className="mh-slash">/</span> {player.assists}</strong><small>{kda(player)} KDA</small><div className="mh-review-status"><span className={`mh-status mh-${match.status.toLowerCase()}`}>{statusLabel(match)}</span>{match.booster && <small>{match.booster.username}</small>}</div></div>
                <dl className="mh-stats"><div><dt title="Kill participation">P/Kill</dt><dd>{participation}%</dd></div><div><dt>CS</dt><dd>{player.cs} <small>({csPerMinute(player, details.duration)}/m)</small></dd></div><div><dt>Damage</dt><dd>{compactNumber(player.damage)}</dd></div><div><dt>Gold</dt><dd>{compactNumber(player.gold)}</dd></div></dl>
                <Roster teams={teams} selected={details.selected} assets={assets} />
            </div>
            <button type="button" className="mh-expand" aria-expanded={expanded} aria-controls={detailsId} aria-label={`${expanded ? 'Hide' : 'Show'} match details for ${match.externalId}`} title={expanded ? 'Hide match details' : 'Show match details'} onClick={() => { setHasExpanded(true); setExpanded(value => !value); }}><Chevron /></button>
        </div>
        <div className={`mh-details${expanded ? ' mh-details-open' : ''}`} id={detailsId} aria-hidden={!expanded} inert={!expanded}><div className="mh-details-inner">{hasExpanded && <Scoreboard match={match} teams={teams} assets={assets} path={path} />}</div></div>
        {canReview && <fieldset className="mh-review" disabled={busy}><legend>Admin review</legend>
            <label>Played by<select aria-label={`Booster for ${match.externalId}`} value={boosterId} onChange={e => setBoosterId(e.target.value)}><option value="">Select booster</option>{boosters.map(b => <option key={b.id} value={b.id}>{b.username || 'Booster'}</option>)}</select></label>
            <label className="mh-note">Review note<input aria-label={`Review note for ${match.externalId}`} placeholder="Reason if excluding this match" maxLength={500} value={note} onChange={e => setNote(e.target.value)} /></label>
            <button className="mh-primary" disabled={!boosterId} onClick={() => onReview(match, 'APPROVED', boosterId, note)}>Approve match</button>
            <button disabled={!note.trim()} onClick={() => onReview(match, 'REJECTED', null, note)}>Exclude</button>
            {match.status !== 'PENDING' && <button onClick={() => onReview(match, 'PENDING', null, note)}>Undo review</button>}
        </fieldset>}
    </article>;
}

function SubmissionConfirmation({ quote, busy, error, onClose, onConfirm }) {
    const dialog = useRef(null);
    useEffect(() => {
        const element = dialog.current;
        element.showModal();
        return () => element.close();
    }, []);
    return <dialog ref={dialog} className="mh-confirmation" aria-labelledby="mh-confirm-title" aria-describedby="mh-confirm-description" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
        <span className="mh-confirm-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m5 12 4 4L19 6" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
        <h2 id="mh-confirm-title">Submit {quote.selectedCount} {quote.selectedCount === 1 ? 'match' : 'matches'}?</h2>
        <p id="mh-confirm-description">Only the matches you selected will be added to the customer’s history.</p>
        <dl className="mh-confirm-totals"><div><dt>Selected now</dt><dd>{quote.selectedCount} matches</dd></div><div><dt>Your submitted total</dt><dd>{quote.totalMatches} matches</dd></div><div className="mh-confirm-pay"><dt>Your estimated earnings</dt><dd>{money(quote.estimatedCents, quote.currency)}</dd></div></dl>
        <p className="mh-confirm-help">Estimated total for all your submitted matches. Final pay depends on admin approval and other booster submissions.</p>
        {error && <p className="mh-error" role="alert">{error}</p>}
        <div className="mh-confirm-actions"><button type="button" disabled={busy} onClick={onClose} autoFocus>Back</button><button type="button" className="mh-primary" disabled={busy || Boolean(error)} onClick={onConfirm}>{busy ? 'Submitting…' : 'Confirm submission'}</button></div>
    </dialog>;
}

export default function MatchHistory({ orderId }) {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [now, setNow] = useState(() => Date.now());
    const [nextStart, setNextStart] = useState(null);
    const [notice, setNotice] = useState('');
    const [page, setPage] = useState(1);
    const [selection, setSelection] = useState({});
    const [quote, setQuote] = useState(null);
    const [submitError, setSubmitError] = useState('');
    const listStart = useRef(null);
    const path = `/match-history/${orderId}`;
    useEffect(() => {
        let active = true;
        operations(path).then(result => { if (active) { setData(result); setError(''); setSelection({}); setPage(1); setQuote(null); } }).catch(e => { if (active) setError(e.message); });
        return () => { active = false; };
    }, [path]);
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 60000);
        return () => clearInterval(timer);
    }, []);
    async function action(route, body) {
        setBusy(true); setError(''); setNotice('');
        try {
            const result = route ? await operations(`${path}${route}`, body) : null;
            if (route === '/import') { setNextStart(result.nextStart); setNotice(result.imported ? `${result.imported} new matches added for review.` : body.start ? 'No new matches in this batch.' : 'Match history is up to date.'); }
            const fresh = await operations(path); setData(fresh);
        } catch (e) { setError(e.message); } finally { setBusy(false); }
    }
    const counts = { APPROVED: 0, PENDING: 0, REJECTED: 0, unsubmitted: 0 };
    data?.matches.forEach(m => { if (selectable(m)) counts.unsubmitted++; else counts[m.status]++; });
    const selected = data?.canSubmit ? data.matches.filter(m => selectable(m) && selection[m.id] === m.revision) : [];
    const totalPages = Math.max(1, Math.ceil((data?.matches.length || 0) / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages);
    const firstMatch = (currentPage - 1) * PAGE_SIZE;
    async function previewSubmission() {
        setBusy(true); setError(''); setSubmitError('');
        try {
            const matches = selected.map(({ id, revision }) => ({ id, revision }));
            const preview = await operations(`${path}/submission-preview`, { matches });
            setQuote({ ...preview, matches });
        } catch (e) { setError(e.message); } finally { setBusy(false); }
    }
    async function submitMatches() {
        setBusy(true); setSubmitError('');
        try {
            const result = await operations(`${path}/submit`, { matches: quote.matches, revision: quote.revision, estimatedCents: quote.estimatedCents });
            setSelection({}); setQuote(null);
            setNotice(`${quote.selectedCount} matches submitted for review.`);
            // Submission has succeeded even if the following read fails.
            setData(previous => ({ ...previous, order: { ...previous.order, revision: quote.revision + 1 },
                submission: { ...previous.submission, matches: quote.totalMatches, estimatedCents: quote.estimatedCents },
                matches: previous.matches.map(m => quote.matches.some(s => s.id === m.id) ? { ...m, boosterId: result.boosterId, revision: m.revision + 1 } : m) }));
            try { setData(await operations(path)); } catch { setError('Matches submitted. Refresh to see the updated totals.'); }
        } catch (e) { setSubmitError(e.message); } finally { setBusy(false); }
    }
    return <section className="mh-panel" aria-label="Match history">
        <header className="mh-heading"><div><h2>Match history</h2><p>Results, builds, and reviewed contributions.</p></div><div className="mh-actions"><button className="mh-refresh" type="button" disabled={busy} aria-label={busy ? 'Refreshing match history' : 'Refresh match history'} title="Refresh match history" aria-busy={busy} onClick={() => data?.canImport ? action('/import', { start: 0 }) : action('')}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 7a7 7 0 0 1 11.55-1.9L20 8M4 16l2.35 2.9A7 7 0 0 0 17.9 17" /></svg></button></div></header>
        {error && <p className="mh-error" role="alert">{error}</p>}{notice && <p className="mh-sr-only" role="status">{notice}</p>}
        {!data && !error && <p role="status">Loading match history…</p>}
        {data && <>
            {!data.order.enabled && <p className="mh-notice">This order uses match-count contribution approvals.</p>}
            {data.importIssue && <p className="mh-notice">{data.importIssue}</p>}
            <div className="mh-counts"><span><strong>{counts.APPROVED + counts.PENDING}</strong> submitted</span><span><strong>{counts.APPROVED}</strong> approved</span>{!data.customerView && <><span><strong>{counts.PENDING}</strong> to review</span><span><strong>{counts.unsubmitted}</strong> not submitted</span>{counts.REJECTED > 0 && <span><strong>{counts.REJECTED}</strong> excluded</span>}</>}</div>
            {data.submission && <div className="mh-own-earnings"><span>Your {data.submission.confirmedCents === null ? 'estimated' : 'confirmed'} earnings <small>{data.submission.matches} submitted matches</small></span><strong>{money(data.submission.confirmedCents ?? data.submission.estimatedCents, data.submission.currency)}</strong></div>}
            {data.canSubmit && <div className="mh-selection-bar"><div><strong>{selected.length} {selected.length === 1 ? 'match' : 'matches'} selected</strong><p>Select only the games you played. Selections stay checked across pages.</p></div><div className="mh-actions">{selected.length > 0 && <button className="mh-clear" disabled={busy} onClick={() => setSelection({})}>Clear</button>}<button className="mh-primary" disabled={busy || !selected.length} onClick={previewSubmission}>Submit selected</button></div></div>}
            <div ref={listStart} className="mh-page-start" tabIndex={-1} />
            {data.matches.length === 0 ? <div className="mh-empty"><span aria-hidden="true">◇</span><h3>No matches yet</h3><p>{data.canImport ? 'Use refresh to check for ranked matches played after this order was paid.' : 'Submitted matches for this order will appear here.'}</p></div> : <>
                <div className="mh-list" id={`match-list-${orderId}`}>{data.matches.slice(firstMatch, firstMatch + PAGE_SIZE).map(match => <MatchCard key={`${match.id}-${match.revision}`} match={match} path={path} boosters={data.boosters} canReview={data.canReview} canSelect={data.canSubmit && selectable(match)} checked={selected.some(m => m.id === match.id)} onSelect={() => setSelection(previous => ({ ...previous, [match.id]: previous[match.id] === match.revision ? null : match.revision }))} busy={busy} now={now} onReview={(m, decision, boosterId, note) => action(`/${m.id}/review`, { revision: m.revision, decision, boosterId, note })} />)}</div>
                <div className="mh-pagination"><p role="status">Showing {firstMatch + 1}–{Math.min(firstMatch + PAGE_SIZE, data.matches.length)} of {data.matches.length} matches · {PAGE_SIZE} per page</p><OrderPagination currentPage={currentPage} totalPages={totalPages} tableId={`match-list-${orderId}`} label="Match history pages" onPageChange={next => { setPage(next); listStart.current?.focus({ preventScroll: true }); listStart.current?.scrollIntoView({ block: 'start' }); }} /></div>
            </>}
            {data.canImport && nextStart !== null && <button disabled={busy} onClick={() => action('/import', { start: nextStart })}>Load older matches</button>}
            {data.earnings && data.order.enabled && <footer className="mh-earnings"><div><h3>Booster earnings pool <span>{money(data.earnings.boosterCents, data.earnings.currency)}</span></h3><p>70% of the service revenue, split by approved matches. Unsubmitted games do not count. {data.order.confirmedAt ? 'Earnings confirmed.' : 'Estimates below depend on admin approval.'}</p>{(data.order.confirmedAt ? data.earnings.shares : data.earnings.estimates || []).map(s => <div className="mh-share" key={s.boosterId}><span>{data.boosters.find(b => b.id === s.boosterId)?.username || data.matches.find(m => m.boosterId === s.boosterId)?.booster?.username || 'Booster'} · {s.matches} matches</span><strong>{money(s.cents, data.earnings.currency)}{!data.order.confirmedAt && <small> estimated</small>}</strong></div>)}</div>
                {data.canConfirm && <button className="mh-primary" disabled={busy || !counts.APPROVED || counts.PENDING > 0} onClick={() => action('/confirm', { revision: data.order.revision })}>Confirm matches for earnings</button>}
                {data.canReview && !data.canConfirm && <small>Earnings can be confirmed once the order is completed.</small>}
                {data.canReopen && <button disabled={busy} onClick={() => action('/reopen', { revision: data.order.revision })}>Reopen review &amp; unconfirm earnings</button>}
            </footer>}
        </>}
        {quote && <SubmissionConfirmation quote={quote} busy={busy} error={submitError} onClose={() => { setQuote(null); setSubmitError(''); }} onConfirm={submitMatches} />}
    </section>;
}
