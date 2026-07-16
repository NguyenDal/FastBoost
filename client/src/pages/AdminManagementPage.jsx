import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import "../styles/Admin.css";

const managementCards = [
    {
        title: "Order Management",
        description:
            "View customer orders, assign boosters, update status, and open order details.",
        icon: "📦",
        path: "/admin/orders",
        status: "Ready",
    },
    {
        title: "Account Management",
        description:
            "Manage user roles such as customer, booster, and admin.",
        icon: "👤",
        path: "/admin/accounts",
        status: "Ready",
    },
    {
        title: "Price Management",
        description:
            "View service pricing rules, manage sales, and control sale duration.",
        icon: "💰",
        path: "/admin/prices",
        status: "Ready",
    },
];

export default function AdminManagementPage() {
    return (
        <div className="page-shell">
            <Navbar />

            <main className="page-container">
                <section className="admin-list-hero">
                    <div>
                        <p className="admin-eyebrow">FastBoost Admin</p>

                        <h1 className="admin-order-title">
                            Management Utilities
                        </h1>

                        <p className="admin-list-subtitle">
                            Central hub for managing orders, accounts, pricing,
                            and sales.
                        </p>
                    </div>

                    <div className="admin-list-stats">
                        <div className="admin-stat-card">
                            <span>Utilities</span>
                            <strong>{managementCards.length}</strong>
                        </div>

                        <div className="admin-stat-card">
                            <span>Active</span>
                            <strong>{managementCards.length}</strong>
                        </div>
                    </div>
                </section>

                <section className="management-grid">
                    {managementCards.map((card) => (
                        <Link
                            key={card.title}
                            to={card.path}
                            className="management-card management-card-active"
                        >
                            <div className="management-card-top">
                                <div className="management-icon">
                                    {card.icon}
                                </div>

                                <span className="management-status ready">
                                    {card.status}
                                </span>
                            </div>

                            <div>
                                <h2>{card.title}</h2>
                                <p>{card.description}</p>
                            </div>

                            <div className="management-card-footer">
                                <span>Open utility</span>
                                <span className="management-arrow">→</span>
                            </div>
                        </Link>
                    ))}
                </section>
            </main>
        </div>
    );
}