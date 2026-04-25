import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import "../styles/MatchPage.css";

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
    const { orderId } = useParams();

    const [hasSession, setHasSession] = useState(false);
    const [currentUser, setCurrentUser] = useState(null);
    const [profileImage, setProfileImage] = useState("");
    const [showProfileMenu, setShowProfileMenu] = useState(false);

    const [showAuthModal, setShowAuthModal] = useState(false);
    const [authMode, setAuthMode] = useState("login");
    const [authMessage, setAuthMessage] = useState("");
    const [authSuccess, setAuthSuccess] = useState(false);
    const [loginErrors, setLoginErrors] = useState({ email: false, password: false });
    const [registerErrors, setRegisterErrors] = useState({ email: false, password: false });
    const [forgotError, setForgotError] = useState(false);
    const [forgotEmail, setForgotEmail] = useState("");

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
        const token = localStorage.getItem("token");
        const savedUser = localStorage.getItem("user");

        if (token && savedUser) {
            const parsedUser = JSON.parse(savedUser);
            setHasSession(true);
            setCurrentUser(parsedUser);
            setProfileImage(parsedUser?.profileImage || "");
        } else {
            setHasSession(false);
            setCurrentUser(null);
            setProfileImage("");
        }
    }, []);

    const handleLogout = () => {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        setHasSession(false);
        setCurrentUser(null);
        setProfileImage("");
        setShowProfileMenu(false);
    };

    useEffect(() => {
        const fetchOrder = async () => {
            try {
                const token = localStorage.getItem("token");

                if (!token) {
                    setOrder(null);
                    return;
                }

                const response = await fetch(`http://localhost:5000/api/orders/${orderId}`, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.message || "Failed to load order");
                }

                setOrder(data.order);
            } catch (error) {
                setOrder(null);
            }
        };

        fetchOrder();
    }, [orderId]);

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
                        text: `Hey! I’m ${match.name}. I’ve reviewed your ${order.boostType || order.service?.title} request and I’m ready to help.`,
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
                    <p className="error-message">Order not found.</p>
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
            <Navbar
                hasSession={hasSession}
                currentUser={currentUser}
                profileImage={profileImage}
                showProfileMenu={showProfileMenu}
                setShowProfileMenu={setShowProfileMenu}
                setAuthMode={setAuthMode}
                setAuthMessage={setAuthMessage}
                setAuthSuccess={setAuthSuccess}
                setLoginErrors={setLoginErrors}
                setRegisterErrors={setRegisterErrors}
                setForgotError={setForgotError}
                setForgotEmail={setForgotEmail}
                setShowAuthModal={setShowAuthModal}
                handleLogout={handleLogout}
            />
            <div className="order-page-container">

                <section className="service-banner-card">
                    <div className="service-banner-left">
                        <p className="section-label">Order Status</p>
                        <h1 className="service-banner-title">{getOrderTitle(order)}</h1>
                        <p className="service-banner-meta">
                            #{order.id} • Total ${order.totalPrice}
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
                                    <strong>{order.duoWithBooster ? "Active" : "Off"}</strong>
                                </div>
                                <div className="option-row">
                                    <span>Priority Order</span>
                                    <strong>{order.priorityOrder ? "Active" : "Off"}</strong>
                                </div>
                                <div className="option-row">
                                    <span>Live Stream</span>
                                    <strong>{order.liveStream ? "Active" : "Off"}</strong>
                                </div>
                                <div className="option-row">
                                    <span>Appear Offline</span>
                                    <strong>{order.appearOffline ? "Active" : "Off"}</strong>
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
                                    <strong>{order.region || "-"}</strong>
                                </div>
                                <div className="info-row">
                                    <span>Queue</span>
                                    <strong>{order.queueType || "-"}</strong>
                                </div>
                                <div className="info-row">
                                    <span>Service</span>
                                    <strong>{order.boostType || order.service?.title || "-"}</strong>
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
    const region = order?.region;

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

    if (order.boostType === "Rank Boost") {
        return `Rank Boost — ${order.currentRank} to ${order.desiredRank}`;
    }

    if (order.boostType === "Placement Boost") {
        return `Placement Boost — ${order.placementGames} Placement Games`;
    }

    if (order.boostType === "Win Boost") {
        return `Win Boost — ${order.desiredWins} Ranked Wins`;
    }

    if (order.boostType === "Pro Duo") {
        return `Pro Duo — ${order.numberOfGames} Games`;
    }

    return order.boostType || order.service?.title || "Service Match";
}

export default MatchPage;