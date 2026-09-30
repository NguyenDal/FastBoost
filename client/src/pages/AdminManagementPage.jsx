import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import { OrdersIcon, UsersIcon, PriceIcon } from "../components/AdminIcons";
import { SupportIcon } from "../components/SupportChat";
import "../styles/Admin.css";

const managementCards = [
    { title: 'Earnings', description: 'Track service revenue, FastBoost earnings, and booster shares.', icon: <PriceIcon />, path: '/admin/earnings' },
    { title: 'Booster Management', description: 'Review match contributions, manage contracts, and see team earnings.', icon: <UsersIcon />, path: '/admin/boosters' },
    {
        title: "Support Inbox",
        description: "Read customer messages and reply to support conversations.",
        icon: <SupportIcon />,
        path: "/admin/support",
    },
    {
        title: "Order Management",
        description:
            "View customer orders, assign boosters, update status, and open order details.",
        icon: <OrdersIcon />,
        path: "/admin/orders",
    },
    {
        title: "Account Management",
        description:
            "Manage user roles such as customer, booster, and admin.",
        icon: <UsersIcon />,
        path: "/admin/accounts",
    },
    {
        title: "Price Management",
        description:
            "View service pricing rules, manage sales, and control sale duration.",
        icon: <PriceIcon />,
        path: "/admin/prices",
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

                            </div>

                            <div>
                                <h2>{card.title}</h2>
                                <p>{card.description}</p>
                            </div>

                            <div className="management-card-footer">
                                <span className="management-arrow">→</span>
                            </div>
                        </Link>
                    ))}
                </section>
            </main>
        </div>
    );
}
