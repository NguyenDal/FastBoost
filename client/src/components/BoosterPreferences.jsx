import { useEffect, useRef, useState } from 'react';
import { operations } from '../api/operations';
import { loadChampions } from '../api/champions';
import { roleNames, roleIconMap, getSecondRoleOptions } from '../data/championRoles';

const emptyPreferences = { firstRole: null, secondRole: null, championIds: [] };

function ChampionPortrait({ champion, id }) {
    const [failed, setFailed] = useState(false);
    return champion?.icon && !failed
        ? <img src={champion.icon} alt="" onError={() => setFailed(true)} />
        : <span className="booster-champion-fallback" aria-hidden="true">{(champion?.name || id).slice(0, 2)}</span>;
}

function SavedRole({ label, value }) {
    const [failedSource, setFailedSource] = useState('');
    const source = roleIconMap[value];
    const description = `${label}: ${value}`;
    return <span className="booster-preferred-role">
        <span aria-hidden="true">{label}</span>
        <span className="booster-preferred-role-icon" role="img" aria-label={description} title={description}>
            {source && failedSource !== source
                ? <img src={source} alt="" onError={() => setFailedSource(source)} />
                : <span aria-hidden="true">{value}</span>}
        </span>
    </span>;
}

function RoleChoices({ label, roles, value, onChange, disabled }) {
    return <fieldset className="booster-role-choices" disabled={disabled}>
        <legend>{label}</legend>
        <div>{roles.map(role => <label key={role} className={value === role ? 'selected' : ''}>
            <input type="radio" name={label} value={role} checked={value === role} onChange={() => onChange(role)} />
            <img src={roleIconMap[role]} alt="" /><span>{role}</span>
        </label>)}</div>
    </fieldset>;
}

function PreferencesEditor({ preferences, champions, catalogError, loading, onRetry, onClose, onSave }) {
    const dialogRef = useRef(null);
    const searchRef = useRef(null);
    const [draft, setDraft] = useState(() => ({ ...preferences, firstRole: preferences.firstRole || 'Top', secondRole: preferences.secondRole || 'Fill' }));
    const [search, setSearch] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const selected = new Set(draft.championIds);
    const matches = champions.filter(champion => !selected.has(champion.id) && champion.name.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 12);
    const byId = new Map(champions.map(champion => [champion.id, champion]));

    useEffect(() => {
        const dialog = dialogRef.current;
        const previousOverflow = document.body.style.overflow;
        dialog.showModal();
        document.body.style.overflow = 'hidden';
        return () => { dialog.close(); document.body.style.overflow = previousOverflow; };
    }, []);

    async function save(event) {
        event.preventDefault();
        if (busy) return;
        setBusy(true); setError('');
        try {
            const result = await operations('/me/preferences', draft, 'PATCH');
            onSave(result.preferences);
        } catch (failure) {
            setError(failure.message);
            setBusy(false);
        }
    }

    function addChampion(id) {
        if (draft.championIds.length >= 5 || selected.has(id)) return;
        setDraft(current => ({ ...current, championIds: [...current.championIds, id] }));
        setSearch('');
        searchRef.current?.focus();
    }

    return <dialog ref={dialogRef} className="booster-preferences-dialog" aria-labelledby="booster-preferences-title"
        onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
        onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
        <form onSubmit={save}>
            <header><div><h2 id="booster-preferences-title">Preferred champions</h2><p>Choose your roles and up to 5 champions you play best.</p></div><button type="button" aria-label="Close preferred champions" disabled={busy} onClick={onClose}>×</button></header>
            <div className="booster-preferences-body">
                <RoleChoices label="First role" roles={roleNames} value={draft.firstRole} disabled={busy} onChange={firstRole => setDraft(current => ({ ...current, firstRole, secondRole: current.secondRole === firstRole ? 'Fill' : current.secondRole }))} />
                <section className="booster-champion-picker" aria-labelledby="booster-champion-label">
                    <div className="booster-champion-picker-heading"><label id="booster-champion-label" htmlFor="booster-champion-search">Select champions</label><span aria-live="polite">{draft.championIds.length} / 5</span></div>
                    <input ref={searchRef} id="booster-champion-search" type="search" placeholder="Search by champion name…" autoComplete="off" value={search} disabled={busy} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} />
                    {loading && <p role="status">Loading champions…</p>}
                    {catalogError && <div className="ops-error" role="alert">{catalogError} <button type="button" onClick={onRetry} disabled={busy}>Retry champion list</button></div>}
                    {search.trim() && !loading && !catalogError && (matches.length ? <div className="booster-champion-results" aria-label="Champion search results">
                        {matches.map(champion => <button key={champion.id} type="button" disabled={busy || selected.size >= 5} onClick={() => addChampion(champion.id)}>
                            <ChampionPortrait champion={champion} id={champion.id} /><span>{champion.name}</span><span aria-hidden="true">+</span>
                        </button>)}
                    </div> : <p role="status">No more champions match “{search}”.</p>)}
                    {selected.size >= 5 && <p role="status">5 champions selected. Remove one to choose another.</p>}
                    <div className="booster-selected-champions" aria-label="Selected champions">
                        {draft.championIds.map(id => <button key={id} type="button" aria-label={`Remove ${byId.get(id)?.name || id}`} disabled={busy} onClick={() => setDraft(current => ({ ...current, championIds: current.championIds.filter(value => value !== id) }))}>
                            <ChampionPortrait champion={byId.get(id)} id={id} /><span>{byId.get(id)?.name || id}</span><span aria-hidden="true">×</span>
                        </button>)}
                    </div>
                </section>
                <RoleChoices label="Second role" roles={getSecondRoleOptions(draft.firstRole)} value={draft.secondRole} disabled={busy} onChange={secondRole => setDraft(current => ({ ...current, secondRole }))} />
                {error && <div className="ops-error" role="alert">{error}</div>}
            </div>
            <footer><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="ops-primary" disabled={busy}>{busy ? 'Saving…' : 'Save selection'}</button></footer>
        </form>
    </dialog>;
}

export default function BoosterPreferences({ preferences = emptyPreferences, available = true, onSave }) {
    const [editing, setEditing] = useState(false);
    const [saved, setSaved] = useState(false);
    const [catalog, setCatalog] = useState({ champions: [], error: '', loaded: false });
    const [attempt, setAttempt] = useState(0);
    const hasChampions = preferences.championIds.length > 0;
    const needsCatalog = editing || hasChampions;
    useEffect(() => {
        if (!needsCatalog) return;
        let active = true;
        loadChampions().then(champions => { if (active) setCatalog({ champions, error: '', loaded: true }); })
            .catch(() => { if (active) setCatalog({ champions: [], error: 'Could not load champions. Please try again.', loaded: true }); });
        return () => { active = false; };
    }, [needsCatalog, attempt]);
    const byId = new Map(catalog.champions.map(champion => [champion.id, champion]));

    return <section className="booster-preferences" aria-labelledby="booster-preferences-heading">
        <div className="booster-preferences-heading"><h3 id="booster-preferences-heading">Preferred champions</h3><button type="button" disabled={!available} onClick={() => { setSaved(false); setEditing(true); }}>{hasChampions || preferences.firstRole ? 'Edit' : 'Choose champions'}</button></div>
        {!available ? <p>Champion preferences are temporarily unavailable.</p> : hasChampions ? <ul className="booster-profile-champions">
            {preferences.championIds.map(id => <li key={id}><ChampionPortrait champion={byId.get(id)} id={id} /><span>{byId.get(id)?.name || id}</span></li>)}
        </ul> : <p>No preferred champions selected yet.</p>}
        {preferences.firstRole && <div className="booster-preferred-roles"><SavedRole label="First role" value={preferences.firstRole} />{preferences.secondRole && <SavedRole label="Second role" value={preferences.secondRole} />}</div>}
        {saved && <p className="booster-preferences-saved" role="status">Preferences saved.</p>}
        {editing && <PreferencesEditor preferences={preferences} champions={catalog.champions} catalogError={catalog.error} loading={!catalog.loaded}
            onRetry={() => { setCatalog({ champions: [], error: '', loaded: false }); setAttempt(value => value + 1); }}
            onClose={() => setEditing(false)} onSave={value => { onSave(value); setEditing(false); setSaved(true); }} />}
    </section>;
}
