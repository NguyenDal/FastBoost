import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import "../styles/Admin.css";

const managementCards = [
    {
        title: "Order Management",
        description: "View customer orders, assign boosters, update status, and open order details.",
        icon: "📦",
        path: "/admin/orders",
        status: "Ready",
        active: true,
    },
    {
        title: "Account Management",
        description: "Manage user roles such as customer, booster, and admin.",
        icon: "👤",
        path: "/admin/accounts",
        status: "Ready",
        active: true,
    },
    {
        title: "Booster Management",
        description: "Review booster workload, assigned orders, and availability.",
        icon: "🎮",
        status: "Coming Soon",
        active: false,
    },
    {
        title: "Service Management",
        description: "Manage LoL/TFT services, service visibility, and service card setup.",
        icon: "🛠️",
        status: "Coming Soon",
        active: false,
    },
    {
        title: "Event Management",
        description: "Create and manage FastBoost events shown on the homepage.",
        icon: "🎉",
        status: "Coming Soon",
        active: false,
    },
    {
        title: "Update Management",
        description: "Post platform updates, service changes, and announcement content.",
        icon: "📰",
        status: "Coming Soon",
        active: false,
    },
    {
        title: "FAQ Management",
        description: "Manage FAQ and help content for customers and boosters.",
        icon: "❓",
        status: "Coming Soon",
        active: false,
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
                        <h1 className="admin-order-title">Management Utilities</h1>
                        <p className="admin-list-subtitle">
                            Central hub for managing orders, users, boosters, services, events, updates, and FAQ content.
                        </p>
                    </div>

                    <div className="admin-list-stats">
                        <div className="admin-stat-card">
                            <span>Utilities</span>
                            <strong>{managementCards.length}</strong>
                        </div>
                        <div className="admin-stat-card">
                            <span>Active</span>
                            <strong>{managementCards.filter((card) => card.active).length}</strong>
                        </div>
                    </div>
                </section>

                <section className="management-grid">
                    {managementCards.map((card) => {
                        const content = (
                            <>
                                <div className="management-card-top">
                                    <div className="management-icon">{card.icon}</div>
                                    <span className={`management-status ${card.active ? "ready" : "soon"}`}>
                                        {card.status}
                                    </span>
                                </div>

                                <div>
                                    <h2>{card.title}</h2>
                                    <p>{card.description}</p>
                                </div>

                                <div className="management-card-footer">
                                    <span>{card.active ? "Open utility" : "Display only for now"}</span>
                                    <span className="management-arrow">→</span>
                                </div>
                            </>
                        );

                        if (card.active && card.path) {
                            return (
                                <Link
                                    key={card.title}
                                    to={card.path}
                                    className="management-card management-card-active"
                                >
                                    {content}
                                </Link>
                            );
                        }

                        return (
                            <div
                                key={card.title}
                                className="management-card management-card-disabled"
                            >
                                {content}
                            </div>
                        );
                    })}
                </section>
            </main>
        </div>
    );
}