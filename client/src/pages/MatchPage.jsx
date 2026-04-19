import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import "../App.css";

const demoBoosters = [
    {
        id: "b1",
        name: "Nova",
        rank: "Diamond I",
        role: "Jungle",
        winRate: "68%",
        region: "North America",
        status: "Online",
        rating: 4.9,
        reviews: 184,
        bio: "Fast climbing specialist focused on clean communication and consistent ranked results.",
        avatar:
            "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=300&q=80",
    },
    {
        id: "b2",
        name: "Blitz",
        rank: "Master",
        role: "Mid",
        winRate: "71%",
        region: "Europe West",
        status: "Online",
        rating: 4.8,
        reviews: 231,
        bio: "Mid lane carry player with strong matchup knowledge and high-tempo decision making.",
        avatar:
            "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=80",
    },
    {
        id: "b3",
        name: "Vex",
        rank: "Emerald I",
        role: "Support",
        winRate: "64%",
        region: "North America",
        status: "Online",
        rating: 4.7,
        reviews: 96,
        bio: "Support-focused booster who prefers duo-friendly communication and safe macro play.",
        avatar:
            "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&q=80",
    },
];

function MatchPage() {
    const { serviceId } = useParams();

    const [order, setOrder] = useState(null);
    const [matchStatus, setMatchStatus] = useState("searching");
    const [matchedBooster, setMatchedBooster] = useState(null);
    const [messages, setMessages] = useState([
        {
            id: 1,
            sender: "system",
            text: "Your order has been placed. Looking for an available booster...",
            timestamp: "3:37 PM",
        },
    ]);
    const [chatInput, setChatInput] = useState("");

    useEffect(() => {
        try {
            const savedOrder = localStorage.getItem("demoOrder");

            if (savedOrder) {
                setOrder(JSON.parse(savedOrder));
            }
        } catch (error) {
            setOrder(null);
        }
    }, []);

    useEffect(() => {
        if (!order) return;

        const timer = setTimeout(() => {
            const match = findDemoBooster(order);

            if (match) {
                setMatchedBooster(match);
                setMatchStatus("matched");
                setMessages((prev) => [
                    ...prev,
                    {
                        id: prev.length + 1,
                        sender: "system",
                        text: `${match.name} has been assigned to your order.`,
                        timestamp: "3:38 PM",
                    },
                    {
                        id: prev.length + 2,
                        sender: "booster",
                        text: `Hey! I’m ${match.name}. I’ve reviewed your ${order.serviceTitle} request and I’m ready to help.`,
                        timestamp: "3:39 PM",
                    },
                ]);
            } else {
                setMatchStatus("searching");
                setMessages((prev) => [
                    ...prev,
                    {
                        id: prev.length + 1,
                        sender: "system",
                        text: "Still searching for a booster. No suitable booster is available yet.",
                        timestamp: "3:38 PM",
                    },
                ]);
            }
        }, 2500);

        return () => clearTimeout(timer);
    }, [order]);

    const statusText = useMemo(() => {
        if (matchStatus === "matched") return "Booster matched";
        return "Searching for booster...";
    }, [matchStatus]);

    const handleSendMessage = (event) => {
        event.preventDefault();

        if (!chatInput.trim() || !matchedBooster) return;

        const userMessage = {
            id: messages.length + 1,
            sender: "user",
            text: chatInput.trim(),
            timestamp: "3:40 PM",
        };

        const boosterReply = {
            id: messages.length + 2,
            sender: "booster",
            text: "Got it. Thanks for the update — I’ll follow your notes for this demo order.",
            timestamp: "3:41 PM",
        };

        setMessages((prev) => [...prev, userMessage, boosterReply]);
        setChatInput("");
    };

    if (!order) {
        return (
            <div className="order-page-shell">
                <div className="order-page-container">
                    <p className="error-message">No demo order found.</p>
                    <Link to="/" className="secondary-btn details-link-btn">
                        Back to homepage
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="order-page-shell">
            <div className="order-page-bg-overlay" />

            <div className="order-page-container">
                <div className="order-page-topbar">
                    <Link to="/" className="order-page-brand">
                        <div className="brand-icon">F</div>
                        <div>
                            <p className="brand-title">FastBoost</p>
                            <p className="brand-subtitle">Match & Chat</p>
                        </div>
                    </Link>

                    <Link to="/" className="order-cancel-btn">
                        Back to Home
                    </Link>
                </div>

                <section className="service-banner-card">
                    <div className="service-banner-left">
                        <p className="section-label">Order Status</p>
                        <h1 className="service-banner-title">{getOrderTitle(order)}</h1>
                        <p className="service-banner-meta">
                            #{order.orderId || "483498"} • Total ${order.totalPrice}
                        </p>
                    </div>

                    <div className="service-banner-right">
                        <span className="service-status-badge">
                            {matchedBooster ? "Matched" : "Searching"}
                        </span>
                    </div>
                </section>

                <div className="match-tabs">
                    <button className="match-tab active">Details</button>
                    <button className="match-tab">Match History</button>
                </div>

                <div className="match-layout">
                    <section className="match-main-panel">
                        <div className="chat-panel">
                            <div className="chat-panel-header">
                                <div className="chat-header-profile">
                                    {matchedBooster ? (
                                        <>
                                            <div className="chat-avatar-wrap">
                                                <img
                                                    src={matchedBooster.avatar}
                                                    alt={matchedBooster.name}
                                                    className="chat-header-avatar"
                                                />
                                                <span className="chat-avatar-online-dot" />
                                            </div>

                                            <div className="chat-header-info">
                                                <p className="chat-header-title">Chat</p>
                                                <p className="chat-header-subtitle">
                                                    {matchedBooster.name} • {matchedBooster.rank}
                                                </p>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="chat-header-info">
                                            <p className="chat-header-title">Chat</p>
                                            <p className="chat-header-subtitle">Waiting for booster match</p>
                                        </div>
                                    )}
                                </div>

                                <span className="chat-status-pill">
                                    {matchedBooster ? "Live chat enabled" : "Searching"}
                                </span>
                            </div>

                            <div className="chat-messages">
                                {messages.map((message) => {
                                    const isBooster = message.sender === "booster";
                                    const isUser = message.sender === "user";
                                    const isSystem = message.sender === "system";

                                    return (
                                        <div
                                            key={message.id}
                                            className={`chat-row chat-row-${message.sender}`}
                                        >
                                            {isBooster && matchedBooster && (
                                                <div className="chat-avatar-wrap">
                                                    <img
                                                        src={matchedBooster.avatar}
                                                        alt={matchedBooster.name}
                                                        className="chat-message-avatar"
                                                    />
                                                    <span className="chat-avatar-online-dot" />
                                                </div>
                                            )}

                                            <div
                                                className={`chat-message chat-message-${message.sender}`}
                                            >
                                                <div className="chat-message-top">
                                                    <span className="chat-sender">
                                                        {isUser
                                                            ? "You"
                                                            : isBooster
                                                                ? matchedBooster?.name || "Booster"
                                                                : "System"}
                                                    </span>

                                                    <span className="chat-timestamp">
                                                        {message.timestamp || "3:37 PM"}
                                                    </span>
                                                </div>

                                                <p>{message.text}</p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            <form className="chat-input-row" onSubmit={handleSendMessage}>
                                <input
                                    type="text"
                                    placeholder={
                                        matchedBooster
                                            ? "Type a message to your booster..."
                                            : "Chat unlocks after a booster is matched"
                                    }
                                    value={chatInput}
                                    onChange={(event) => setChatInput(event.target.value)}
                                    disabled={!matchedBooster}
                                />
                                <button
                                    type="submit"
                                    className="primary-btn"
                                    disabled={!matchedBooster}
                                >
                                    Send
                                </button>
                            </form>
                        </div>

                        <div className="match-options-card">
                            <div className="match-card-header">
                                <h3>Options</h3>
                            </div>

                            <div className="option-list">
                                <div className="option-row">
                                    <span>Play with Booster</span>
                                    <strong>{order.formData.duoWithBooster ? "Active" : "Off"}</strong>
                                </div>
                                <div className="option-row">
                                    <span>Priority Order</span>
                                    <strong>{order.formData.priorityOrder ? "Active" : "Off"}</strong>
                                </div>
                                <div className="option-row">
                                    <span>Live Stream</span>
                                    <strong>{order.formData.liveStream ? "Active" : "Off"}</strong>
                                </div>
                                <div className="option-row">
                                    <span>Appear Offline</span>
                                    <strong>{order.formData.appearOffline ? "Active" : "Off"}</strong>
                                </div>
                            </div>
                        </div>
                    </section>

                    <aside className="match-sidebar">
                        <div className="match-side-card">
                            <p className="section-label">Assigned Booster</p>

                            {!matchedBooster ? (
                                <p className="section-description">Searching for booster...</p>
                            ) : (
                                <div className="booster-profile-card">
                                    <div className="booster-profile-top">
                                        <img
                                            src={matchedBooster.avatar}
                                            alt={matchedBooster.name}
                                            className="booster-avatar"
                                        />

                                        <div className="booster-profile-main">
                                            <div className="booster-name-row">
                                                <h3>{matchedBooster.name}</h3>
                                                <span className="booster-online-dot">
                                                    {matchedBooster.status}
                                                </span>
                                            </div>

                                            <p className="booster-rank-role">
                                                {matchedBooster.rank} • {matchedBooster.role}
                                            </p>

                                            <div className="booster-rating-row">
                                                <span className="booster-stars">
                                                    {renderStars(matchedBooster.rating)}
                                                </span>
                                                <span className="booster-rating-text">
                                                    {matchedBooster.rating} / 5 ({matchedBooster.reviews} reviews)
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    <p className="booster-bio">{matchedBooster.bio}</p>
                                </div>
                            )}
                        </div>

                        <div className="match-side-card">
                            <p className="section-label">Login Info</p>

                            <div className="info-list">
                                <div className="info-row">
                                    <span>Region</span>
                                    <strong>{order.formData.region}</strong>
                                </div>
                                <div className="info-row">
                                    <span>Queue</span>
                                    <strong>{order.formData.queueType}</strong>
                                </div>
                                <div className="info-row">
                                    <span>Service</span>
                                    <strong>{order.serviceTitle}</strong>
                                </div>
                            </div>
                        </div>

                        <div className="match-side-card">
                            <p className="section-label">Order Summary</p>

                            <div className="info-list">
                                <div className="info-row">
                                    <span>Total</span>
                                    <strong>${order.totalPrice}</strong>
                                </div>
                                <div className="info-row">
                                    <span>Status</span>
                                    <strong>{matchedBooster ? "Matched" : "Searching"}</strong>
                                </div>
                            </div>

                            <Link to="/" className="order-back-link">
                                Back to homepage
                            </Link>
                        </div>
                    </aside>
                </div>
            </div>
        </div>
    );
}

function findDemoBooster(order) {
    const region = order?.formData?.region;

    if (!region) return null;

    const normalizedRegion =
        region === "North America" ? "North America" : region;

    return (
        demoBoosters.find((booster) => booster.region === normalizedRegion) || null
    );
}

function renderStars(rating) {
    const fullStars = Math.floor(rating);
    const emptyStars = 5 - fullStars;
    return "★".repeat(fullStars) + "☆".repeat(emptyStars);
}

function getOrderTitle(order) {
    if (!order) return "Service Match";

    if (order.serviceTitle === "Rank Boost") {
        return `Rank Boost — ${order.formData.currentRank} to ${order.formData.desiredRank}`;
    }

    if (order.serviceTitle === "Placement Boost") {
        return `Placement Boost — ${order.formData.placementGames} Placement Games`;
    }

    if (order.serviceTitle === "Win Boost") {
        return `Win Boost — ${order.formData.desiredWins} Ranked Wins`;
    }

    if (order.serviceTitle === "Pro Duo") {
        return `Pro Duo — ${order.formData.numberOfGames} Games`;
    }

    return order.serviceTitle;
}

export default MatchPage;