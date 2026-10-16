import { Link, NavLink, useLocation } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { OrdersIcon, UsersIcon, PriceIcon, ActivityIcon } from '../components/AdminIcons';
import '../styles/Admin.css';
import '../styles/AdminLayout.css';
import '../styles/BoosterPortal.css';

const sections = [
    ['/provider/orders', 'Assigned Orders', <OrdersIcon />],
    ['/provider/earnings', 'Earnings', <PriceIcon />],
    ['/provider/documents', 'Documents', <ActivityIcon />],
    ['/provider/profile', 'Profile', <UsersIcon />],
];

export default function BoosterPortalLayout({ children }) {
    const { pathname } = useLocation();
    const isOverview = pathname.replace(/\/$/, '') === '/provider/portal';
    const content = <>
        <header className="admin-list-hero booster-portal-heading">
            <div><p className="booster-portal-eyebrow">FASTBOOST TEAM</p>
            <h1 className="admin-order-title">Booster Portal</h1></div>
        </header>
        {children}
    </>;

    return <div className={`${isOverview ? 'page-shell' : 'admin-shell admin-with-sidebar'} booster-portal-shell`}>
        <Navbar />
        {isOverview ? <main className="page-container booster-portal">{content}</main> : <div className="admin-layout booster-portal-layout">
            <aside className="admin-sidebar booster-portal-sidebar">
                <div className="admin-sidebar-header"><h2>Booster Portal</h2></div>
                <nav className="admin-side-nav" aria-label="Booster Portal">
                    {sections.map(([path, label, icon]) => <NavLink key={path} to={path} className={({ isActive }) => `admin-side-link${isActive ? ' active' : ''}`}>{icon}<span>{label}</span></NavLink>)}
                </nav>
                <div className="admin-side-divider" />
                <Link to="/provider/portal" className="admin-side-link admin-side-back-link">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 7 5 11l4 4M6 11h7a6 6 0 1 1 0 12h-2" /></svg>
                    <span>Back</span>
                </Link>
            </aside>
            <main className="admin-main booster-portal">{content}</main>
        </div>}
    </div>;
}
