import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import BoosterPortalLayout from '../layouts/BoosterPortalLayout';
import BoosterPreferences from '../components/BoosterPreferences';
import BoosterMonthlyEarnings from '../components/BoosterMonthlyEarnings';
import { OrdersIcon, UsersIcon, PriceIcon } from '../components/AdminIcons';
import { operations, date } from '../api/operations';
import { Contributions } from './OperationsPages';
import '../styles/Operations.css';

const cards = [
    { path: 'orders', title: 'Assigned Orders', text: 'Open your orders, track progress, and connect with customers.', icon: <OrdersIcon /> },
    { path: 'earnings', title: 'Earnings', text: 'Check confirmed earnings and submit your match contributions.', icon: <PriceIcon /> },
    { path: 'documents', title: 'Documents', text: 'Review agreements, sign contracts, and download your copies.', icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M14 3H5v18h14V8zM14 3v5h5M9 12h6M9 16h6" /></svg> },
    { path: 'profile', title: 'Booster Profile', text: 'View your team profile, preferred champions, and customer rating.', icon: <UsersIcon /> },
];

function Rating({ rating }) {
    return <section className="ops-card booster-rating">
        <span className="booster-portal-eyebrow">CUSTOMER RATING</span>
        <div className="booster-rating-value"><span aria-hidden="true">★</span><strong>{rating?.available === false ? 'Unavailable' : <>{rating?.count ? `${rating.average.toFixed(1)}/5` : '0.0/5'} <small>({rating?.count || 0} {rating?.count === 1 ? 'review' : 'reviews'})</small></>}</strong></div>
    </section>;
}

export default function BoosterPortalPage({ section = 'overview' }) {
    const [state, setState] = useState({ data: null, error: '' });
    const [version, setVersion] = useState(0);
    useEffect(() => {
        let active = true;
        operations('/me').then(data => { if (active) setState({ data, error: '' }); })
            .catch(error => { if (active) setState({ data: null, error: error.message }); });
        return () => { active = false; };
    }, [section, version]);
    const { data, error } = state;
    const name = data?.account?.profile?.displayName || data?.account?.username || 'Booster';
    return <BoosterPortalLayout>
        <div className="ops-page booster-portal-content">
            {error && <div className="ops-error" role="alert">{error} <button type="button" onClick={() => setVersion(value => value + 1)}>Try again</button></div>}
            {!data && !error && <p role="status">Loading your workspace…</p>}
            {section === 'overview' && <>
                <section className="booster-portal-grid" aria-label="Your workspace">
                    {cards.map(card => <Link key={card.path} className="booster-portal-card" to={`/provider/${card.path}`}>
                        <span className="booster-portal-icon">{card.icon}</span><h3>{card.title}</h3><p>{card.text}</p><span className="booster-portal-arrow" aria-hidden="true">↗</span>
                    </Link>)}
                </section>
            </>}
            {section === 'earnings' && <>
                <BoosterMonthlyEarnings version={version} />
                <Contributions onChange={() => setVersion(value => value + 1)} />
            </>}
            {section === 'documents' && <>
                <section className="ops-card"><h2>Your contracts</h2><p>Review your agreements and keep a copy of your signed documents.</p>
                    {data && (data.contracts.length ? data.contracts.map(contract => <Link className="ops-contract-link" key={contract.id} to={`/provider/contracts/${contract.id}`}>
                        <span>{contract.title}<small>Starts {date(contract.startsAt)}</small></span><span className={`ops-badge ${contract.signedAt && !contract.revokedAt ? 'approved' : ''}`}>{contract.archivedAt ? 'Archived' : contract.revokedAt ? 'Revoked' : contract.signedAt ? 'Signed' : contract.signingProvider === 'FASTBOOST' ? !contract.documentAvailable ? 'Awaiting FastBoost' : !contract.boosterSignedAt ? 'Review & sign' : 'Awaiting FastBoost' : 'Review & sign'} →</span>
                    </Link>) : <p>No contracts have been issued to you yet.</p>)}
                </section>
            </>}
            {section === 'profile' && data && <div className="booster-profile-grid">
                <section className="ops-card"><div className="booster-profile-identity">
                    {data.account?.profile?.profileImageUrl ? <img src={data.account.profile.profileImageUrl} alt="" /> : <span className="booster-profile-avatar" aria-hidden="true">{name[0]}</span>}
                    <h2>{name}</h2>
                </div>
                    <BoosterPreferences preferences={data.preferences} available={data.preferencesAvailable} onSave={preferences => setState(current => ({ ...current, data: { ...current.data, preferences, preferencesAvailable: true } }))} />
                    <Link className="booster-profile-edit" to="/account/settings">Edit account profile <span aria-hidden="true">↗</span></Link></section>
                <Rating rating={data.rating} />
            </div>}
        </div>
    </BoosterPortalLayout>;
}
