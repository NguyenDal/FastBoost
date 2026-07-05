import { Link } from "react-router-dom";
import { useState } from "react";
import Navbar from "../components/Navbar";
import "../styles/Admin.css";
import "../styles/PriceManagement.css";

const pricingServices = [
    {
        id: "lol-rank",
        service: "Rank Boost",
        game: "LoL",
        type: "Rank-based",
        baseDisplay: "Dynamic",
        sale: "None",
        saleEnds: "—",
        status: "Active",
    },
    {
        id: "lol-placement",
        service: "Placement Boost",
        game: "LoL",
        type: "Placement-based",
        baseDisplay: "Dynamic",
        sale: "None",
        saleEnds: "—",
        status: "Active",
    },
    {
        id: "lol-win",
        service: "Win Boost",
        game: "LoL",
        type: "Per-win",
        baseDisplay: "Dynamic",
        sale: "None",
        saleEnds: "—",
        status: "Active",
    },
    {
        id: "lol-duo",
        service: "Pro Duo",
        game: "LoL",
        type: "Duo / Add-on",
        baseDisplay: "Dynamic",
        sale: "None",
        saleEnds: "—",
        status: "Active",
    },
    {
        id: "tft-rank",
        service: "TFT Rank Boost",
        game: "TFT",
        type: "Rank-based",
        baseDisplay: "Dynamic",
        sale: "None",
        saleEnds: "—",
        status: "Active",
    },
    {
        id: "tft-win",
        service: "TFT Win Boost",
        game: "TFT",
        type: "Per-win",
        baseDisplay: "Dynamic",
        sale: "None",
        saleEnds: "—",
        status: "Active",
    },
    {
        id: "tft-placement",
        service: "TFT Placement Boost",
        game: "TFT",
        type: "Placement-based",
        baseDisplay: "Dynamic",
        sale: "None",
        saleEnds: "—",
        status: "Active",
    },
];

export default function PriceManagementPage() {
    const [saleModalOpen, setSaleModalOpen] = useState(false);
    const [selectedService, setSelectedService] = useState(null);

    const openSaleModal = (service = null) => {
        setSelectedService(service);
        setSaleModalOpen(true);
    };

    const closeSaleModal = () => {
        setSaleModalOpen(false);
        setSelectedService(null);
    };

    const activeServices = pricingServices.filter((item) => item.status === "Active").length;
    const activeSales = pricingServices.filter((item) => item.sale !== "None").length;

    return (
        <div className="page-shell">
            <Navbar />

            <main className="page-container price-management-page">
                <section className="admin-list-hero price-hero">
                    <div>
                        <p className="admin-eyebrow">FastBoost Admin</p>
                        <h1 className="admin-order-title">
                            Price <span>Management</span>
                        </h1>
                        <p className="admin-list-subtitle">
                            Manage dynamic service pricing rules, sale activation, and sale duration.
                        </p>
                    </div>

                    <div className="price-hero-actions">
                        <Link to="/admin/management" className="price-secondary-btn">
                            ← Back
                        </Link>

                        <button
                            type="button"
                            className="price-primary-btn"
                            onClick={() => openSaleModal()}
                        >
                            + Create Sale
                        </button>
                    </div>
                </section>

                <section className="price-stats-grid">
                    <article className="price-stat-card">
                        <span className="price-stat-icon">🧾</span>
                        <div>
                            <p>Total Services</p>
                            <strong>{pricingServices.length}</strong>
                            <span>Pricing rules tracked</span>
                        </div>
                    </article>

                    <article className="price-stat-card">
                        <span className="price-stat-icon">✅</span>
                        <div>
                            <p>Active Services</p>
                            <strong>{activeServices}</strong>
                            <span>Available to customers</span>
                        </div>
                    </article>

                    <article className="price-stat-card">
                        <span className="price-stat-icon">🏷️</span>
                        <div>
                            <p>Active Sales</p>
                            <strong>{activeSales}</strong>
                            <span>Current sale campaigns</span>
                        </div>
                    </article>

                    <article className="price-stat-card">
                        <span className="price-stat-icon">⏱️</span>
                        <div>
                            <p>Upcoming Sales</p>
                            <strong>0</strong>
                            <span>Scheduled promotions</span>
                        </div>
                    </article>
                </section>

                <section className="price-layout">
                    <div className="price-main-panel">
                        <div className="price-toolbar">
                            <div className="price-tabs">
                                <button className="price-tab price-tab-active">All Games</button>
                                <button className="price-tab">League of Legends</button>
                                <button className="price-tab">Teamfight Tactics</button>
                            </div>

                            <div className="price-search-row">
                                <select>
                                    <option>All Status</option>
                                    <option>Active</option>
                                    <option>On Sale</option>
                                    <option>Scheduled</option>
                                </select>

                                <input type="text" placeholder="Search service..." />
                            </div>
                        </div>

                        <div className="price-table-card">
                            <div className="price-table-header">
                                <div>
                                    <h2>Service Pricing Rules</h2>
                                    <p>
                                        These services use dynamic pricing from the order calculator.
                                    </p>
                                </div>
                            </div>

                            <div className="price-table-wrap">
                                <table className="price-table">
                                    <thead>
                                        <tr>
                                            <th>Service</th>
                                            <th>Game</th>
                                            <th>Pricing Type</th>
                                            <th>Base Display</th>
                                            <th>Sale</th>
                                            <th>Sale Ends</th>
                                            <th>Status</th>
                                            <th>Actions</th>
                                        </tr>
                                    </thead>

                                    <tbody>
                                        {pricingServices.map((item) => (
                                            <tr key={item.id}>
                                                <td>
                                                    <strong>{item.service}</strong>
                                                </td>
                                                <td>
                                                    <span className={`price-game-pill ${item.game === "LoL" ? "lol" : "tft"}`}>
                                                        {item.game}
                                                    </span>
                                                </td>
                                                <td>{item.type}</td>
                                                <td>{item.baseDisplay}</td>
                                                <td>{item.sale}</td>
                                                <td>{item.saleEnds}</td>
                                                <td>
                                                    <span className="price-status-pill active">
                                                        {item.status}
                                                    </span>
                                                </td>
                                                <td>
                                                    <button
                                                        type="button"
                                                        className="price-row-btn"
                                                        onClick={() => openSaleModal(item)}
                                                    >
                                                        Edit
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    <aside className="price-side-panel">
                        <section className="price-side-card">
                            <h3>Sale Control</h3>
                            <p>
                                Activate a discount for one or more services and choose how long it stays active.
                            </p>

                            <div className="price-sale-preview">
                                <span>Example</span>
                                <strong>15% OFF Rank Boost</strong>
                                <p>Applies to calculated base price before checkout.</p>
                            </div>
                            <button
                                type="button"
                                className="price-primary-btn price-full-btn"
                                onClick={() => openSaleModal()}
                            >
                                Create Sale
                            </button>
                        </section>

                        <section className="price-side-card">
                            <h3>Pricing Logic</h3>

                            <div className="price-rule-list">
                                <div>
                                    <strong>Rank Boost</strong>
                                    <span>Current rank → desired rank</span>
                                </div>

                                <div>
                                    <strong>Win Boost</strong>
                                    <span>Rank tier × number of wins</span>
                                </div>

                                <div>
                                    <strong>Placement</strong>
                                    <span>Peak rank × placement games</span>
                                </div>

                                <div>
                                    <strong>Add-ons</strong>
                                    <span>Priority, coaching, stream, privacy</span>
                                </div>
                            </div>
                        </section>
                    </aside>
                </section>
            </main>

            {saleModalOpen && (
                <div className="price-modal-backdrop" onClick={closeSaleModal}>
                    <section
                        className="price-modal"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="price-modal-header">
                            <div>
                                <p className="admin-eyebrow">Sale Setup</p>
                                <h2>
                                    {selectedService
                                        ? `Edit ${selectedService.service}`
                                        : "Create Sale"}
                                </h2>
                                <p>
                                    Configure a temporary discount without changing the original pricing rules.
                                </p>
                            </div>

                            <button
                                type="button"
                                className="price-modal-close"
                                onClick={closeSaleModal}
                            >
                                ×
                            </button>
                        </div>

                        <div className="price-modal-grid">
                            <label className="price-modal-field">
                                <span>Service</span>
                                <select defaultValue={selectedService?.id || ""}>
                                    <option value="">Select service</option>
                                    {pricingServices.map((service) => (
                                        <option key={service.id} value={service.id}>
                                            {service.service}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <label className="price-modal-field">
                                <span>Discount %</span>
                                <input type="number" min="1" max="90" placeholder="15" />
                            </label>

                            <label className="price-modal-field">
                                <span>Sale Start</span>
                                <input type="datetime-local" />
                            </label>

                            <label className="price-modal-field">
                                <span>Sale End</span>
                                <input type="datetime-local" />
                            </label>

                            <label className="price-modal-field price-modal-field-wide">
                                <span>Apply Discount To</span>
                                <select defaultValue="base">
                                    <option value="base">Base price only</option>
                                    <option value="total">Whole order total</option>
                                </select>
                            </label>
                        </div>

                        <div className="price-modal-note">
                            <strong>Safe behavior:</strong>
                            <span>
                                This sale will sit on top of the current dynamic calculator. It does not overwrite Rank Boost, Win Boost, Placement, or add-on pricing.
                            </span>
                        </div>

                        <div className="price-modal-actions">
                            <button
                                type="button"
                                className="price-secondary-btn"
                                onClick={closeSaleModal}
                            >
                                Cancel
                            </button>

                            <button
                                type="button"
                                className="price-primary-btn"
                                onClick={closeSaleModal}
                            >
                                Save Draft
                            </button>
                        </div>
                    </section>
                </div>
            )}
        </div>
    );
}