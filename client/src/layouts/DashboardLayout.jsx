import { Link, Outlet, useLocation } from "react-router-dom";
import Navbar from "../components/Navbar";
import "../styles/Dashboard.css";

export default function DashboardLayout() {
    const location = useLocation();

    const user = (() => {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    })();

    const role = user?.role || "CUSTOMER";
    const ordersPath = role === "PROVIDER" ? "/provider/orders" : "/account/orders";

    return (
        <div className="dashboard-shell dashboard-with-sidebar">
            <Navbar />

            <div className="dashboard-layout">
                <aside className="dashboard-sidebar">
                    <nav className="dashboard-side-nav">
                        <Link
                            to="/account/dashboard"
                            className={location.pathname === "/account/dashboard" ? "active" : ""}
                        >
                            <DashboardIcon />
                            <span>Dashboard</span>
                        </Link>

                        <Link
                            to={ordersPath}
                            className={location.pathname.includes("/orders") ? "active" : ""}
                        >
                            <OrdersIcon />
                            <span>My Orders</span>
                        </Link>

                        <Link
                            to="/account/change-password"
                            className={location.pathname === "/account/change-password" ? "active" : ""}
                        >
                            <LockIcon />
                            <span>Change Password</span>
                        </Link>

                        <Link to="/" className="dashboard-home-link">
                            <HomeIcon />
                            <span>Home</span>
                        </Link>
                    </nav>
                </aside>

                <main className="dashboard-main">
                    <Outlet />
                </main>
            </div>
        </div>
    );
}

function DashboardIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none">
            <path d="M4 4h7v7H4V4ZM13 4h7v7h-7V4ZM4 13h7v7H4v-7ZM13 13h7v7h-7v-7Z" stroke="currentColor" strokeWidth="1.8" />
        </svg>
    );
}

function OrdersIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none">
            <path d="M7 4h13l-2 10H8L7 4ZM7 4H4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM17 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" stroke="currentColor" strokeWidth="1.8" />
        </svg>
    );
}

function LockIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none">
            <path
                d="M7 10V8a5 5 0 0 1 10 0v2"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
            />
            <path
                d="M6 10h12v10H6V10Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
            />
            <path
                d="M12 14v2"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
            />
        </svg>
    );
}

function HomeIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none">
            <path d="M3 11.5 12 4l9 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M6 10.5V20h12v-9.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
    );
}