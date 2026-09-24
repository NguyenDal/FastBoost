import { useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import "../styles/Faq.css";
import { faqQuestions, refundStages } from "../data/faq";

const topics = [
    { name: 'Popular', label: 'Quick answers', icon: 'star' },
    { name: 'Orders', label: 'Progress & delivery', icon: 'box' },
    { name: 'Payments', label: 'Payments & refunds', icon: 'card' },
    { name: 'Account', label: 'Account & safety', icon: 'shield' },
    { name: 'Rewards', label: 'Gold & coupons', icon: 'gift' },
];

function TopicIcon({ type }) {
    const paths = {
        star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z',
        box: 'm3 7 9-4 9 4v10l-9 4-9-4Zm0 0 9 4 9-4M12 11v10M7.5 5l9 4',
        card: 'M3 5h18v14H3ZM3 9h18M6 15h4',
        shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Zm-4 9 3 3 5-6',
        gift: 'M3 8h18v4H3Zm2 4v9h14v-9M12 8v13M12 8S4 8 6 4c2-3 6 4 6 4s4-7 6-4c2 4-6 4-6 4Z',
    };
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[type]} /></svg>;
}

function RefundGuide() {
    const [stage, setStage] = useState(refundStages[0].id);
    const selected = refundStages.find(item => item.id === stage);
    return <div className="faq-refund-guide">
        <p className="faq-refund-prompt">Has your service started?</p>
        <div className="faq-refund-options" role="group" aria-label="Order stage">
            {refundStages.map(item => <button type="button" key={item.id} aria-pressed={stage === item.id} onClick={() => setStage(item.id)}>{item.label}</button>)}
        </div>
        <div className="faq-refund-result" aria-live="polite" aria-atomic="true"><h3>{selected.title}</h3><p>{selected.answer}</p></div>
        <p className="faq-refund-note">Your legal rights still apply. Email support@fastboost.gg with your order number to request cancellation.</p>
        <Link to="/contact">Contact support <span aria-hidden="true">↗</span></Link>
    </div>;
}

function HelpIcon({ search = false }) {
    return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {search ? <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></> : <><path d="M4 13v-1a8 8 0 0 1 16 0v1M4 12H3v6h4v-6H4Zm16 0h1v6h-4v-6h3ZM20 18v1a2 2 0 0 1-2 2h-4" /><path d="M11 21h3" /></>}
    </svg>;
}

export default function FaqPage() {
    const [query, setQuery] = useState("");
    const [topic, setTopic] = useState("Popular");
    const [openQuestion, setOpenQuestion] = useState(null);
    const search = query.trim().toLowerCase();
    const visible = faqQuestions.filter(item => search
        ? [item.question, item.answer, item.topic, ...(item.interactive === 'refund' ? refundStages.map(stage => stage.answer) : [])].join(' ').toLowerCase().includes(search)
        : topic === 'Popular' ? item.popular : item.topic === topic);
    const chooseTopic = value => { setTopic(value); setQuery(''); setOpenQuestion(null); };


    return <div className="faq-shell">
        <Navbar />
        <main className="faq-page">
        <header className="faq-hero">
            <div className="faq-hero-copy">
                <h1>Frequently asked questions</h1>
                <p>Pick a topic. Find your next step.</p>
            </div>
            <div className="faq-hero-art" aria-hidden="true"><div className="faq-orbit" /><span className="faq-question-mark">?</span><span className="faq-art-spark">✦</span></div>
        </header>

        <div className="faq-search">
            <HelpIcon search />
            <input type="search" aria-label="Search frequently asked questions" placeholder="Search refunds, orders, account safety…" value={query} onChange={event => { setQuery(event.target.value); setOpenQuestion(null); }} />
            {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search">×</button>}
        </div>

        <div className="faq-topic-list" role="group" aria-label="Question topics">
            {topics.map(item => <button type="button" key={item.name} aria-pressed={!search && topic === item.name} onClick={() => chooseTopic(item.name)}><TopicIcon type={item.icon} /><span>{item.label}</span></button>)}
        </div>

        <div className="faq-layout">
            <section className="faq-questions" aria-label={search ? 'Search results' : topics.find(item => item.name === topic).label}>
                {visible.length ? <div className="faq-accordion">
                    {visible.map(item => {
                        const open = openQuestion === item.id;
                        return <article key={item.id} className={open ? 'faq-item is-open' : 'faq-item'}>
                            <h3><button type="button" id={`faq-question-${item.id}`} aria-expanded={open} aria-controls={`faq-answer-${item.id}`} onClick={() => setOpenQuestion(open ? null : item.id)}>{item.question}<span className="faq-expand" aria-hidden="true">+</span></button></h3>
                            <div className="faq-answer" id={`faq-answer-${item.id}`} role="region" aria-labelledby={`faq-question-${item.id}`} hidden={!open}>
                                {item.interactive === 'refund' ? <RefundGuide /> : <><p>{item.answer}</p>{item.to && <Link to={item.to}>{item.action} <span aria-hidden="true">↗</span></Link>}</>}
                            </div>
                        </article>;
                    })}
                </div> : <div className="faq-empty" role="status"><HelpIcon search /><h3>No matching questions</h3><p>Try another phrase or choose a topic.</p><button type="button" onClick={() => chooseTopic('Popular')}>Clear search</button></div>}
                <p className="faq-terms-note">A quick guide. Your order details and <Link to="/terms-and-conditions">full terms</Link> apply; your legal rights stay protected.</p>
            </section>

            <aside className="faq-aside">
                <section className="faq-support-card">
                    <span className="faq-support-icon"><HelpIcon /></span>
                    <h2>Still need a hand?</h2>
                    <p>Send your order number and we’ll help.</p>
                    <Link to="/contact" className="faq-contact-link">Contact support <span aria-hidden="true">↗</span></Link>
                </section>

            </aside>
        </div>
        </main>
    </div>;
}
