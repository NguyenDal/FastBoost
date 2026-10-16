import { useState } from 'react';
import { roleIconMap } from '../data/championRoles';

function RoleIcon({ role, label }) {
    const [failedSource, setFailedSource] = useState('');
    const source = roleIconMap[role];
    const description = `${label}: ${role}`;
    return <span className="ops-booster-role" role="img" aria-label={description} title={description}>
        {source && failedSource !== source
            ? <img src={source} alt="" onError={() => setFailedSource(source)} />
            : <span aria-hidden="true">{role}</span>}
    </span>;
}

function ChampionIcon({ id, champion }) {
    const [failed, setFailed] = useState(false);
    const name = champion?.name || id;
    return <span className="ops-booster-champion" role="img" aria-label={name} title={name}>
        {champion?.icon && !failed
            ? <img src={champion.icon} alt="" onError={() => setFailed(true)} />
            : <span aria-hidden="true">{name.slice(0, 2)}</span>}
    </span>;
}

export default function BoosterPreferenceSummary({ preferences, champions, available = true }) {
    if (!available) return <span className="ops-booster-preferences ops-booster-preferences-empty">Preferences unavailable</span>;
    const roles = [{ label: 'First role', role: preferences?.firstRole }, { label: 'Second role', role: preferences?.secondRole }].filter(item => item.role);
    const championIds = preferences?.championIds || [];
    return <span className="ops-booster-preferences">
        <span className={`ops-booster-roles${roles.length ? '' : ' ops-booster-preferences-empty'}`}>{roles.length ? roles.map(item => <RoleIcon key={item.label} {...item} />) : 'No roles selected'}</span>
        <span className="ops-booster-preferences-divider" aria-hidden="true">|</span>
        <span className="ops-booster-champions" role="group" aria-label="Preferred champions">
            {championIds.length ? championIds.map(id => <ChampionIcon key={id} id={id} champion={champions.get(id)} />) : <span className="ops-booster-preferences-empty">No champions selected</span>}
        </span>
    </span>;
}
