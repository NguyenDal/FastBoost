import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import "../styles/MatchPage.css";
import {
    getOrderConversation,
    getConversationMessages,
    sendConversationMessage,
} from "../api/chats";

function MatchPage() {
    const { orderId } = useParams();
    const navigate = useNavigate();

    const [hasSession, setHasSession] = useState(false);
    const [currentUser, setCurrentUser] = useState(null);
    const [profileImage, setProfileImage] = useState("");
    const [showProfileMenu, setShowProfileMenu] = useState(false);

    const [conversation, setConversation] = useState(null);
    const [chatLoading, setChatLoading] = useState(true);
    const [chatError, setChatError] = useState("");
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
    const chatEnabled = Boolean(conversation && matchedBooster);

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
        try { window.dispatchEvent(new Event("auth:changed")); } catch { }
        navigate("/", { replace: true });
    };

    // Require auth: if token disappears, go home
    useEffect(() => {
        const check = () => {
            const token = localStorage.getItem("token");
            if (!token) {
                navigate("/", { replace: true });
            }
        };
        check();
        window.addEventListener("auth:changed", check);
        window.addEventListener("storage", check);
        window.addEventListener("focus", check);
        document.addEventListener("visibilitychange", check);
        return () => {
            window.removeEventListener("auth:changed", check);
            window.removeEventListener("storage", check);
            window.removeEventListener("focus", check);
            document.removeEventListener("visibilitychange", check);
        };
    }, [navigate]);

    useEffect(() => {
        const loadChatPage = async () => {
            try {
                setChatLoading(true);
                setChatError("");

                const token = localStorage.getItem("token");

                if (!token) {
                    setOrder(null);
                    return;
                }

                // 1. Load normal order details
                const orderResponse = await fetch(`http://localhost:5000/api/orders/${orderId}`, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });

                const orderData = await orderResponse.json();

                if (!orderResponse.ok) {
                    throw new Error(orderData.message || "Failed to load order");
                }

                const loadedOrder = orderData.order;
                setOrder(loadedOrder);

                // 2. Get or create conversation for this order
                const loadedConversation = await getOrderConversation(orderId);
                setConversation(loadedConversation);

                // 3. Try to find assigned booster from conversation participants or order assignments
                const realBooster = findAssignedBooster(loadedConversation, loadedOrder);
                setMatchedBooster(realBooster);
                setMatchStatus(realBooster ? "matched" : "searching");

                // 4. Load real saved messages
                const savedMessages = await getConversationMessages(loadedConversation.id);

                if (savedMessages.length > 0) {
                    setMessages(
                        savedMessages.map((msg) => ({
                            id: msg.id,
                            sender:
                                msg.senderId === loadedOrder.customerId
                                    ? "user"
                                    : msg.sender?.role === "PROVIDER"
                                        ? "booster"
                                        : msg.sender?.role === "ADMIN"
                                            ? "admin"
                                            : "user",
                            text: msg.content || msg.text || msg.body || msg.message || "",
                            timestamp: formatChatTime(msg.createdAt),
                            senderName: msg.sender?.username || msg.sender?.email,
                        }))
                    );
                } else {
                    setMessages([
                        {
                            id: "system-waiting",
                            sender: "system",
                            text: realBooster
                                ? `${getBoosterDisplayName(realBooster)} has been assigned to your order.`
                                : "Your order has been placed. Waiting for an admin to assign a booster.",
                            timestamp: formatChatTime(new Date()),
                        },
                    ]);
                }
            } catch (error) {
                setChatError(error.message || "Failed to load chat");
                setOrder(null);
            } finally {
                setChatLoading(false);
            }
        };

        loadChatPage();
    }, [orderId]);

    const handleSendMessage = async (event) => {
        event.preventDefault();

        const text = chatInput.trim();

        if (!text || !chatEnabled) return;

        try {
            const tempMessage = {
                id: `temp-${Date.now()}`,
                sender: "user",
                text,
                timestamp: formatChatTime(new Date()),
            };

            setMessages((prev) => [...prev, tempMessage]);
            setChatInput("");

            const savedMessage = await sendConversationMessage(conversation.id, text);

            setMessages((prev) =>
                prev.map((msg) =>
                    msg.id === tempMessage.id
                        ? {
                            id: savedMessage.id,
                            sender: "user",
                            text: savedMessage.content || savedMessage.text || savedMessage.body || savedMessage.message || text,
                            timestamp: formatChatTime(savedMessage.createdAt),
                            senderName:
                                savedMessage.sender?.username || savedMessage.sender?.email || "You",
                        }
                        : msg
                )
            );
        } catch (error) {
            setMessages((prev) => [
                ...prev,
                {
                    id: `error-${Date.now()}`,
                    sender: "system",
                    text: error.message || "Message failed to send.",
                    timestamp: formatChatTime(new Date()),
                },
            ]);
        }
    };

    if (chatLoading) {
        return (
            <div className="order-page-shell">
                <div className="order-page-container">
                    <p className="info-message">Loading order chat...</p>
                </div>
            </div>
        );
    }

    if (!order) {
        return (
            <div className="order-page-shell">
                <div className="order-page-container">
                    <p className="error-message">
                        {chatError || "Order not found."}
                    </p>
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
                                                    src={getBoosterAvatar(matchedBooster)}
                                                    alt={getBoosterDisplayName(matchedBooster)}
                                                    className="chat-header-avatar"
                                                />
                                                <span className="chat-avatar-online-dot" />
                                            </div>

                                            <div className="chat-header-info">
                                                <p className="chat-header-title">Chat</p>
                                                <p className="chat-header-subtitle">
                                                    {getBoosterDisplayName(matchedBooster)} • {matchedBooster.rank || "Provider"}
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
                                                        src={getBoosterAvatar(matchedBooster)}
                                                        alt={getBoosterDisplayName(matchedBooster)}
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
                                                                ? getBoosterDisplayName(matchedBooster)
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
                                        chatEnabled
                                            ? "Type a message to your booster..."
                                            : "Chat unlocks after a booster is assigned"
                                    }
                                    value={chatInput}
                                    onChange={(event) => setChatInput(event.target.value)}
                                    disabled={!chatEnabled}
                                />

                                <button
                                    type="submit"
                                    className="primary-btn"
                                    disabled={!chatEnabled}
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

                            {!matchedBooster ? (
                                <p className="section-description">Searching for booster...</p>
                            ) : (
                                <div className="booster-profile-card">
                                    <div className="booster-profile-top">
                                        <img
                                            src={getBoosterAvatar(matchedBooster)}
                                            alt={getBoosterDisplayName(matchedBooster)}
                                            className="booster-avatar"
                                        />

                                        <div className="booster-profile-main">
                                            <div className="booster-name-row">
                                                <h3>{getBoosterDisplayName(matchedBooster)}</h3>
                                                <span className="booster-online-dot">
                                                    {matchedBooster.status || "Assigned"}
                                                </span>
                                            </div>

                                            {matchedBooster.rating ? (
                                                <div className="booster-rating-row">
                                                    <span className="booster-stars">
                                                        {renderStars(matchedBooster.rating)}
                                                    </span>
                                                    <span className="booster-rating-text">
                                                        {matchedBooster.rating} / 5 ({matchedBooster.reviews || 0} reviews)
                                                    </span>
                                                </div>
                                            ) : (
                                                <div className="booster-rating-row">
                                                    <span className="booster-stars">★★★★★</span>
                                                    <span className="booster-rating-text">
                                                        4.5 / 5 (657 reviews)
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <p className="booster-bio">
                                        {matchedBooster.bio ||
                                            "This booster has been assigned to your order and can now chat with you."}
                                    </p>
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

function formatChatTime(value) {
    if (!value) return "";

    return new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
    });
}

function getBoosterDisplayName(booster) {
    return booster?.username || booster?.email || booster?.name || "Assigned Booster";
}

function getBoosterAvatar(booster) {
    const name = getBoosterDisplayName(booster);

    return (
        booster?.profileImage ||
        booster?.avatar ||
        booster?.profile?.profileImage ||
        booster?.profile?.avatar ||
        booster?.profile?.photoUrl ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=111827&color=fff`
    );
}

function findAssignedBooster(conversation, order) {
    const participants = conversation?.participants || [];

    const boosterFromParticipants = participants
        .map((p) => p.user || p.booster || p.participant || p)
        .find((user) => {
            const role = String(user?.role || "").toUpperCase();
            return role === "PROVIDER" || role === "BOOSTER";
        });

    if (boosterFromParticipants) {
        return boosterFromParticipants;
    }

    const assignments = order?.assignments || order?.orderAssignments || [];

    const boosterFromAssignments = assignments
        .map((a) => a.booster || a.user || a.provider)
        .find(Boolean);

    if (boosterFromAssignments) {
        return boosterFromAssignments;
    }

    return (
        order?.booster ||
        order?.provider ||
        order?.assignedBooster ||
        order?.assignedProvider ||
        null
    );
}

function renderStars(rating) {
    const safeRating = Number(rating || 5);
    const fullStars = Math.max(0, Math.min(5, Math.floor(safeRating)));
    const emptyStars = 5 - fullStars;

    return "★".repeat(fullStars) + "☆".repeat(emptyStars);
}

export default MatchPage;