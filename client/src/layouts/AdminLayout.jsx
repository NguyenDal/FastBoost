import { OrdersIcon, UsersIcon, PriceIcon } from "../components/AdminIcons";
import { Link, Outlet, useLocation } from "react-router-dom";
import Navbar from "../components/Navbar";
import "../styles/AdminLayout.css";

const adminLinks = [
    {
        label: "Order Management",
        path: "/admin/orders",
        icon: <OrdersIcon />,
    },
    {
        label: "Account Management",
        path: "/admin/accounts",
        icon: <UsersIcon />,
    },
    {
        label: "Price Management",
        path: "/admin/prices",
        icon: <PriceIcon />,
    },
];

export default function AdminLayout() {
    const location = useLocation();

    return (
        <div className="admin-shell admin-with-sidebar">
            <Navbar />

            <div className="admin-layout">
                <aside className="admin-sidebar">
                    <div className="admin-sidebar-header">
                        <h2>Control Center</h2>
                    </div>

                    <nav className="admin-side-nav">
                        {adminLinks.map((item) => {
                            const active =
                                location.pathname === item.path ||
                                location.pathname.startsWith(`${item.path}/`);

                            return (
                                <Link
                                    key={item.label}
                                    to={item.path}
                                    className={`admin-side-link ${active ? "active" : ""}`}
                                >
                                    {item.icon}
                                    <span>{item.label}</span>
                                </Link>
                            );
                        })}
                    </nav>

                    <div className="admin-side-divider" />

                    <Link to="/admin/management" className="admin-side-link admin-side-back-link">
                        <CurvedBackIcon />
                        <span>Back</span>
                    </Link>

                </aside>

                <main className="admin-main">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}

function GridIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none">
            <path d="M4 4h7v7H4V4ZM13 4h7v7h-7V4ZM4 13h7v7H4v-7ZM13 13h7v7h-7v-7Z" stroke="currentColor" strokeWidth="1.8" />
        </svg>
    );
}





function BoosterIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none">
            <path d="M7 14h10l2 5H5l2-5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M8 14V7a4 4 0 0 1 8 0v7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
    );
}

function ServiceIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none">
            <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3Z" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" stroke="currentColor" strokeWidth="1.8" />
        </svg>
    );
}



function FaqIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none">
            <path d="M12 18h.01M9.5 9a2.5 2.5 0 1 1 4.2 1.8c-.9.7-1.7 1.2-1.7 2.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" stroke="currentColor" strokeWidth="1.8" />
        </svg>
    );
}

function CurvedBackIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none">
            <path
                d="M9 7 5 11l4 4"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M6 11h7a6 6 0 1 1 0 12h-2"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}