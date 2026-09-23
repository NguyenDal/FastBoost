import { useState } from "react";
import { Link } from "react-router-dom";
import "../styles/Faq.css";

const questions = [
    { id: "track", topic: "Orders", question: "Where can I track my order?", answer: "Open My Orders and select an order to see its status, details, and conversation. Use the status filter to find current or completed orders.", to: "/account/orders", action: "View my orders" },
    { id: "chat", topic: "Orders", question: "How do I contact my booster?", answer: "Open your order from My Orders to access its conversation. Keep questions about your service in the order chat so the details stay together.", to: "/account/orders", action: "Open order chat" },
    { id: "gold", topic: "Rewards", question: "How do I use gold?", answer: "Apply your available gold at checkout. Every 10 gold is worth $1 toward your purchase. You can check your gold balance and loyalty progress on the Loyalty Rewards page.", to: "/account/loyalty", action: "View my rewards" },
    { id: "referrals", topic: "Rewards", question: "How do referral rewards work?", answer: "Share your invite link from the Refer a Friend card on your dashboard. Your friend gets 10% off their first purchase. When their first qualifying order of $50 or more before the referral discount is paid and completed, you both receive 50 gold ($5) for a future purchase.", to: "/account/dashboard", action: "Find my invite link" },
    { id: "coupons", topic: "Rewards", question: "Where can I find my coupons?", answer: "Your dashboard's My Coupons card shows your personal coupon codes and their expiry timers. Copy a code and enter it at checkout, then review the applied discount before paying.", to: "/account/dashboard", action: "Go to my dashboard" },
    { id: "profile", topic: "Account", question: "How do I update my profile?", answer: "Open Account Settings to update your username, email, profile picture, country, or birthday. Select Save Profile when you have finished.", to: "/account/settings", action: "Open account settings" },
    { id: "password", topic: "Account", question: "How do I change my password?", answer: "Go to Change Password, enter your current password, and choose and confirm your new password. If you cannot remember your current password, use Forgot password on the sign-in screen.", to: "/account/change-password", action: "Change my password" },
    { id: "linked", topic: "Account", question: "Where do I manage linked sign-in accounts?", answer: "Open Account Settings and find Linked accounts. You can link an available sign-in provider or unlink one that is already connected. When linking, use the same email as your FastBoost account.", to: "/account/settings", action: "Manage linked accounts" },
];
const topics = ["All questions", "Orders", "Rewards", "Account"];

function HelpIcon({ search = false }) {
    return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {search ? <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></> : <><path d="M4 13v-1a8 8 0 0 1 16 0v1M4 12H3v6h4v-6H4Zm16 0h1v6h-4v-6h3ZM20 18v1a2 2 0 0 1-2 2h-4" /><path d="M11 21h3" /></>}
    </svg>;
}

export default function FaqPage() {
    const [query, setQuery] = useState("");
    const [topic, setTopic] = useState("All questions");
    const search = query.trim().toLowerCase();
    const visible = questions.filter(item => (topic === "All questions" || item.topic === topic)
        && `${item.question} ${item.answer} ${item.topic}`.toLowerCase().includes(search));

    return <div className="faq-page">
        <header className="faq-hero">
            <div className="faq-hero-copy">
                <h1>Frequently asked questions</h1>
                <p>A little guidance for your next step.</p>
            </div>
            <div className="faq-hero-art" aria-hidden="true"><div className="faq-orbit" /><span className="faq-question-mark">?</span><span className="faq-art-spark">✦</span></div>
        </header>

        <div className="faq-search">
            <HelpIcon search />
            <input type="search" aria-label="Search frequently asked questions" placeholder="Search orders, gold, your account…" value={query} onChange={event => setQuery(event.target.value)} />
            {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search">×</button>}
        </div>

        <div className="faq-topic-list" role="group" aria-label="Question topics">
            {topics.map(value => <button type="button" key={value} aria-pressed={topic === value} onClick={() => setTopic(value)}>{value}</button>)}
        </div>

        <div className="faq-layout">
            <section className="faq-questions" aria-labelledby="faq-results-heading">
                <div className="faq-section-heading"><h2 id="faq-results-heading">{search ? "Search results" : topic}</h2><span role="status">{visible.length} {visible.length === 1 ? "answer" : "answers"}</span></div>
                {visible.length ? <div className="faq-accordion">
                    {visible.map(item => <details key={item.id} open={search ? true : undefined}>
                        <summary>{item.question}<span className="faq-expand" aria-hidden="true">+</span></summary>
                        <div className="faq-answer"><p>{item.answer}</p><Link to={item.to}>{item.action} <span aria-hidden="true">↗</span></Link></div>
                    </details>)}
                </div> : <div className="faq-empty"><HelpIcon search /><h3>No matching questions</h3><p>Try a different phrase or browse all topics.</p><button type="button" onClick={() => { setQuery(""); setTopic("All questions"); }}>Clear filters</button></div>}
            </section>

            <aside className="faq-aside">
                <section className="faq-support-card">
                    <span className="faq-support-icon"><HelpIcon /></span>
                    <h2>Still need a hand?</h2>
                    <p>Tell us what you need help with. Our support team can guide you from there.</p>
                    <Link to="/contact" className="faq-contact-link">Contact support <span aria-hidden="true">↗</span></Link>
                </section>
                <nav className="faq-shortcuts" aria-label="Helpful links">
                    <h2>Jump back in</h2>
                    <Link to="/account/orders">My orders <span aria-hidden="true">→</span></Link>
                    <Link to="/account/loyalty">Loyalty rewards <span aria-hidden="true">→</span></Link>
                    <Link to="/account/settings">Account settings <span aria-hidden="true">→</span></Link>
                </nav>
            </aside>
        </div>
    </div>;
}
