import { Link } from "react-router-dom";
import { useRef } from "react";
import { findCountry } from "../utils/countries";
import CleanIcon from "./CleanIcon";
import DashboardIcon from "./DashboardIcon";

function CardHeading({ title, icon, to, action }) {
    return <div className="dashboard-activity-header">
        {["profile", "lightning"].includes(icon) ? <DashboardIcon kind={icon} /> : <span className="dashboard-activity-heading-icon" aria-hidden="true">{icon}</span>}
        <h2>{title}</h2>
        {to && <Link className="dashboard-view-all" to={to}>{action}</Link>}
    </div>;
}

export function DashboardOrders({ orders }) {
    const recent = [...orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 3);
    const labels = { PENDING: "Pending", IN_PROGRESS: "In Progress", COMPLETED: "Completed", CANCELLED: "Cancelled" };
    return <section className="dashboard-card dashboard-orders-card">
        <CardHeading title="My Orders" icon="🛒" to="/account/orders" action="View all" />
        {recent.length ? recent.map(order => {
            const title = order.service?.title || order.boostType || "Order";
            const isTft = /tft|teamfight/i.test(title + " " + (order.boostType || ""));
            return <Link key={order.id} to={"/match/" + order.id} className="dashboard-order-row">
                <CleanIcon className="dashboard-game-logo" src={"https://fastboost-assets.s3.amazonaws.com/logos/" + (isTft ? "tft-logo.png" : "lol-logo.jpg")} alt={isTft ? "TFT" : "LoL"} />
                <div className="dashboard-order-copy"><strong>#{order.orderNumber}</strong><small>{title}</small></div>
                <div className="dashboard-order-meta"><span className={"dashboard-order-status status-" + order.status?.toLowerCase()}>{labels[order.status] || order.status}</span><small>{new Date(order.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</small></div>
                <span aria-hidden="true">›</span>
            </Link>;
        }) : <p className="dashboard-subtitle">No orders yet.</p>}
    </section>;
}

export function DashboardAccount({ account }) {
    const profile = account?.profile || {};
    const name = profile.displayName || account?.username || "Your account";
    const country = findCountry(profile.country);
    const created = account?.createdAt ? new Date(account.createdAt) : null;
    const today = new Date();
    let years = created ? today.getFullYear() - created.getFullYear() : null;
    if (created && (today.getMonth() < created.getMonth() || (today.getMonth() === created.getMonth() && today.getDate() < created.getDate()))) years -= 1;
    const age = years === null ? "Not available" : years < 1 ? "Less than 1 year" : years + (years === 1 ? " year" : " years");
    const birthday = profile.birthday ? new Date(profile.birthday).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "Not set";
    return <section className="dashboard-card">
        <CardHeading title="Account Overview" icon="profile" to="/account/settings" action="View Profile" />
        <div className="dashboard-account-identity">
            {profile.profileImageUrl ? <img src={profile.profileImageUrl} alt="" /> : <span className="dashboard-account-initial">{name.charAt(0)}</span>}
            <div><strong>{name}</strong><small>{account?.email}</small>{account?.emailVerifiedAt && <span className="dashboard-verified">✓ Verified</span>}</div>
        </div>
        <div className="dashboard-account-facts">
            <div><span aria-hidden="true">◷</span><small>Member for</small><strong>{age}</strong></div>
            <div>{country && <img src={"https://flagcdn.com/w40/" + country.code.toLowerCase() + ".png"} alt={country.name + " flag"} />}<small>Country</small><strong>{country?.name || profile.country || "Not set"}</strong></div>
            <div><span aria-hidden="true">▦</span><small>Birthday</small><strong>{birthday}</strong></div>
        </div>
    </section>;
}

export function DashboardQuickActions() {
    const faqRef = useRef(null);
    return <section className="dashboard-card">
        <CardHeading title="Quick Actions" icon="lightning" />
        <div className="dashboard-quick-actions">
            {[ ["Browse Services", "View all services", "/", "▦"], ["Account Settings", "Update your profile", "/account/settings", "⚙"], ["Contact Support", "Get help", "/contact", "☏"] ].map(([title, detail, to, icon]) => <Link key={title} to={to}><span aria-hidden="true">{icon}</span><div><strong>{title}</strong><small>{detail}</small></div></Link>)}
            <button type="button" onClick={() => faqRef.current?.showModal()}><span aria-hidden="true">?</span><div><strong>FAQ</strong><small>Common questions</small></div></button>
        </div>
        <dialog ref={faqRef} className="dashboard-faq-dialog" aria-labelledby="dashboard-faq-title">
            <div className="dashboard-card-header"><h2 id="dashboard-faq-title">Frequently Asked Questions</h2><button type="button" className="dashboard-view-all" onClick={() => faqRef.current?.close()} aria-label="Close FAQ">Close</button></div>
            <details><summary>Where can I track my order?</summary><p>Open My Orders and select an order to see its status and chat.</p></details>
            <details><summary>How do I use gold?</summary><p>Apply your available gold at checkout. Every 10 gold is worth $1 toward your purchase.</p></details>
            <details><summary>How do referral rewards work?</summary><p>Your referred friend gets 10% off their first purchase. When their first qualifying order of $50 or more before the referral discount is paid and completed, you both receive 50 gold ($5) for a future purchase.</p></details>
        </dialog>
    </section>;
}

export function DashboardPlatform() {
    return <section className="dashboard-card">
        <CardHeading title="Platform Status" icon="●" />
        <div className="dashboard-platform-status">
            <div><span>Website</span><strong className="is-available">Available</strong></div>
            <div><span>Order Processing</span><strong>Not monitored</strong></div>
            <div><span>Payments (Stripe)</span><strong>Not monitored</strong></div>
            <div><span>Chat System</span><strong>Not monitored</strong></div>
        </div>
    </section>;
}

