import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import "../styles/MatchPage.css";
import {
    getOrderConversation,
    getConversationMessages,
    sendConversationMessage,
} from "../api/chats";
import { updateOrderLoginInfo } from "../api/orders";

function MatchPage() {
    const { orderId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();

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
    const [showLoginPassword, setShowLoginPassword] = useState(false);
    const [showLoginInfoModal, setShowLoginInfoModal] = useState(false);
    const [loginInfoForm, setLoginInfoForm] = useState({
        inGameName: "",
        accountPassword: "",
    });
    const [loginInfoSaving, setLoginInfoSaving] = useState(false);
    const [loginInfoError, setLoginInfoError] = useState("");

    const [order, setOrder] = useState(null);
    const initialGameMode =
        location.state?.gameMode ||
        sessionStorage.getItem(`fastboost:order:${orderId}:gameMode`) ||
        "lol";

    const loadedOrderGameMode =
        String(order?.boostType || order?.service?.title || "").startsWith("TFT ")
            ? "tft"
            : initialGameMode;

    const matchPageModeClass =
        loadedOrderGameMode === "tft" ? "order-page-tft" : "order-page-lol";
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

    const chatMessagesRef = useRef(null);
    const previousMessagesRef = useRef([]);
    const isInitialChatPositionAppliedRef = useRef(false);
    const shouldScrollAfterSendRef = useRef(false);

    const scrollChatToBottom = useCallback((behavior = "smooth") => {
        const el = chatMessagesRef.current;
        if (!el) return;

        requestAnimationFrame(() => {
            el.scrollTo({
                top: el.scrollHeight,
                behavior,
            });
        });
    }, []);

    const getChatStorageKey = useCallback(
        (suffix) => `fastboost:match:${orderId}:chat:${suffix}`,
        [orderId]
    );

    const isChatNearBottom = useCallback(() => {
        const el = chatMessagesRef.current;
        if (!el) return true;

        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        return distanceFromBottom < 80;
    }, []);

    const saveChatScrollState = useCallback(() => {
        const el = chatMessagesRef.current;
        if (!el) return;

        sessionStorage.setItem(getChatStorageKey("scrollTop"), String(el.scrollTop));

        const lastMessage = messages[messages.length - 1];

        if (lastMessage?.createdAt && isChatNearBottom()) {
            sessionStorage.setItem(getChatStorageKey("lastSeenAt"), lastMessage.createdAt);
        }
    }, [getChatStorageKey, messages, isChatNearBottom]);

    const [scrollThumb, setScrollThumb] = useState({
        height: 0,
        top: 0,
        visible: false,
    });

    const fallbackUser = getStoredUser();
    const effectiveUser = currentUser || fallbackUser;

    const currentUserId = getCurrentUserId(effectiveUser);
    const currentUserRole = String(effectiveUser?.role || "").toUpperCase();

    const isCustomerOwner =
        Boolean(currentUserId) &&
        (
            String(order?.customerId || "") === String(currentUserId) ||
            String(order?.customer?.id || "") === String(currentUserId) ||
            String(order?.customer?.userId || "") === String(currentUserId) ||
            String(order?.userId || "") === String(currentUserId)
        );

    const isAdminUser = currentUserRole === "ADMIN";

    const isAssignedProvider =
        currentUserRole === "PROVIDER" &&
        isUserAssignedToOrder(order, conversation, currentUserId);

    const isConversationParticipant = isUserInConversation(
        conversation,
        currentUserId
    );

    const chatEnabled =
        Boolean(conversation) && Boolean(currentUserId);

    const updateChatScrollbar = useCallback(() => {
        const el = chatMessagesRef.current;
        if (!el) return;

        const { scrollTop, scrollHeight, clientHeight } = el;
        const canScroll = scrollHeight > clientHeight + 4;

        if (!canScroll) {
            setScrollThumb({
                height: 0,
                top: 0,
                visible: false,
            });
            return;
        }

        const minThumbHeight = 48;
        const height = Math.max((clientHeight / scrollHeight) * clientHeight, minThumbHeight);
        const maxTop = clientHeight - height;
        const top = (scrollTop / (scrollHeight - clientHeight)) * maxTop;

        setScrollThumb({
            height,
            top,
            visible: true,
        });
    }, []);

    const scrollToMessageById = useCallback((messageId, behavior = "smooth") => {
        if (!messageId) return;

        requestAnimationFrame(() => {
            const el = chatMessagesRef.current;
            const target = document.querySelector(`[data-message-id="${messageId}"]`);

            if (!el || !target) return;

            const containerTop = el.getBoundingClientRect().top;
            const targetTop = target.getBoundingClientRect().top;
            const offset = targetTop - containerTop;

            el.scrollTo({
                top: el.scrollTop + offset,
                behavior,
            });

            requestAnimationFrame(() => {
                updateChatScrollbar();
            });
        });
    }, [updateChatScrollbar]);

    useEffect(() => {
        updateChatScrollbar();

        const el = chatMessagesRef.current;
        if (!el) return;

        const handleScroll = () => {
            updateChatScrollbar();
            saveChatScrollState();
        };

        el.addEventListener("scroll", handleScroll);
        window.addEventListener("resize", updateChatScrollbar);

        return () => {
            el.removeEventListener("scroll", handleScroll);
            window.removeEventListener("resize", updateChatScrollbar);
        };
    }, [messages, updateChatScrollbar, saveChatScrollState]);

    useEffect(() => {
        if (!messages.length) return;

        const el = chatMessagesRef.current;
        if (!el) return;

        if (!isInitialChatPositionAppliedRef.current) {
            isInitialChatPositionAppliedRef.current = true;

            const lastSeenAt = sessionStorage.getItem(getChatStorageKey("lastSeenAt"));
            const savedScrollTop = sessionStorage.getItem(getChatStorageKey("scrollTop"));

            const firstNewOtherMessage = lastSeenAt
                ? messages.find(
                    (message) =>
                        !message.isMine &&
                        message.sender !== "system" &&
                        message.createdAt &&
                        new Date(message.createdAt).getTime() > new Date(lastSeenAt).getTime()
                )
                : null;

            if (firstNewOtherMessage) {
                scrollToMessageById(firstNewOtherMessage.id, "auto");
            } else if (savedScrollTop !== null) {
                requestAnimationFrame(() => {
                    el.scrollTop = Number(savedScrollTop);
                    updateChatScrollbar();
                });
            } else {
                scrollChatToBottom("auto");
            }

            previousMessagesRef.current = messages;
            return;
        }

        const previousMessages = previousMessagesRef.current;
        const previousLastMessage = previousMessages[previousMessages.length - 1];
        const currentLastMessage = messages[messages.length - 1];

        const hasNewMessage =
            currentLastMessage && currentLastMessage.id !== previousLastMessage?.id;

        if (hasNewMessage) {
            const newMessages = messages.slice(previousMessages.length);

            const hasMyNewMessage = newMessages.some(
                (message) => message.isMine || message.sender === "mine"
            );

            const firstNewOtherMessage = newMessages.find(
                (message) =>
                    !message.isMine &&
                    message.sender !== "mine" &&
                    message.sender !== "system"
            );

            if (shouldScrollAfterSendRef.current || hasMyNewMessage) {
                scrollChatToBottom("smooth");
                shouldScrollAfterSendRef.current = false;
            } else if (isChatNearBottom()) {
                scrollChatToBottom("smooth");
            } else if (firstNewOtherMessage) {
                scrollToMessageById(firstNewOtherMessage.id, "smooth");
            }
        }

        previousMessagesRef.current = messages;
        updateChatScrollbar();
    }, [
        messages,
        getChatStorageKey,
        isChatNearBottom,
        scrollChatToBottom,
        scrollToMessageById,
        updateChatScrollbar,
    ]);

    useEffect(() => {
        isInitialChatPositionAppliedRef.current = false;
        previousMessagesRef.current = [];
        shouldScrollAfterSendRef.current = false;
    }, [orderId]);

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

                const loadedGameMode = String(
                    loadedOrder?.boostType || loadedOrder?.service?.title || ""
                ).startsWith("TFT ")
                    ? "tft"
                    : "lol";

                sessionStorage.setItem(
                    `fastboost:order:${orderId}:gameMode`,
                    loadedGameMode
                );

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
                    const currentUserRaw = localStorage.getItem("user");
                    const loggedInUser = currentUserRaw ? JSON.parse(currentUserRaw) : null;
                    const loggedInUserId = getCurrentUserId(loggedInUser);

                    setMessages(
                        savedMessages.map((msg) => {
                            const isMine = String(msg.senderId || "") === String(loggedInUserId || "");
                            const senderRole = String(msg.sender?.role || "").toUpperCase();

                            return {
                                id: msg.id,
                                sender: isMine ? "mine" : senderRole === "PROVIDER" ? "booster" : senderRole === "ADMIN" ? "admin" : "other",
                                isMine,
                                senderId: msg.senderId,
                                senderRole,
                                senderUser: msg.sender,
                                text: msg.content || msg.text || msg.body || msg.message || "",
                                createdAt: msg.createdAt,
                                timestamp: formatChatTime(msg.createdAt),
                                senderName: getSenderDisplayName(msg.sender),
                                senderAvatar: getSenderAvatar(msg.sender),
                            };
                        })
                    );
                } else {
                    setMessages([
                        {
                            id: "system-waiting",
                            sender: "system",
                            text: realBooster
                                ? `${getBoosterDisplayName(realBooster)} has been assigned to your order.`
                                : "Your order has been placed. Waiting for an admin to assign a booster.",
                            createdAt: new Date().toISOString(),
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

    const isCustomerView = effectiveUser?.role === "CUSTOMER";
    const isProviderView = effectiveUser?.role === "PROVIDER";
    const canEditLoginInfo = isCustomerOwner;

    const inGameName =
        order?.inGameName ||
        order?.gameUsername ||
        order?.loginUsername ||
        order?.summonerName ||
        "-";

    const loginPassword =
        order?.accountPassword ||
        order?.gamePassword ||
        order?.loginPassword ||
        "";

    const needsAccountPassword = requiresAccountPassword(order);

    const displayedPassword =
        showLoginPassword
            ? loginPassword || "Password saved securely. Reload this order to reveal."
            : order?.hasAccountPassword
                ? "••••••••"
                : "-";

    const openLoginInfoModal = () => {
        setLoginInfoForm({
            inGameName: order?.inGameName || "",
            accountPassword: "",
        });
        setLoginInfoError("");
        setShowLoginInfoModal(true);
    };

    const handleSaveLoginInfo = async (event) => {
        event.preventDefault();

        try {
            setLoginInfoSaving(true);
            setLoginInfoError("");

            const payload = {
                inGameName: loginInfoForm.inGameName,
            };

            if (loginInfoForm.accountPassword.trim()) {
                payload.accountPassword = loginInfoForm.accountPassword;
            }

            const updatedOrder = await updateOrderLoginInfo(order.id, payload);

            setOrder((prev) => ({
                ...prev,
                ...updatedOrder,
                accountPassword: loginInfoForm.accountPassword.trim()
                    ? loginInfoForm.accountPassword.trim()
                    : prev?.accountPassword,
                hasAccountPassword:
                    updatedOrder.hasAccountPassword ??
                    Boolean(loginInfoForm.accountPassword.trim()) ??
                    prev?.hasAccountPassword,
            }));

            setLoginInfoForm({
                inGameName: "",
                accountPassword: "",
            });

            setShowLoginInfoModal(false);
            setShowLoginPassword(false);
        } catch (error) {
            setLoginInfoError(error.message || "Failed to save login info");
        } finally {
            setLoginInfoSaving(false);
        }
    };

    const handleSendMessage = async (event) => {
        event.preventDefault();

        const text = chatInput.trim();

        if (!text || !chatEnabled) return;

        try {
            const now = new Date();

            const tempMessage = {
                id: `temp-${Date.now()}`,
                sender: "mine",
                isMine: true,
                senderId: getCurrentUserId(effectiveUser),
                senderRole: effectiveUser?.role,
                senderUser: effectiveUser,
                senderAvatar: getSenderAvatar(effectiveUser),
                senderName: "You",
                text,
                createdAt: now.toISOString(),
                timestamp: formatChatTime(now),
            };

            shouldScrollAfterSendRef.current = true;
            setMessages((prev) => [...prev, tempMessage]);
            setChatInput("");

            const savedMessage = await sendConversationMessage(conversation.id, text);

            setMessages((prev) =>
                prev.map((msg) =>
                    msg.id === tempMessage.id
                        ? {
                            id: savedMessage.id,
                            sender: "mine",
                            isMine: true,
                            senderId: savedMessage.senderId,
                            senderRole: savedMessage.sender?.role,
                            senderUser: savedMessage.sender || effectiveUser,
                            senderName: "You",
                            senderAvatar: getSenderAvatar(savedMessage.sender || effectiveUser),
                            text: savedMessage.content || savedMessage.text || savedMessage.body || savedMessage.message || text,
                            createdAt: savedMessage.createdAt || now.toISOString(),
                            timestamp: formatChatTime(savedMessage.createdAt || now),
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
            <div className={`order-page-shell ${matchPageModeClass}`}>
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
                    <MatchPageSkeleton />
                </div>
            </div>
        );
    }

    if (!order) {
        return (
            <div className={`order-page-shell ${matchPageModeClass}`}>
                <div className="order-page-bg-overlay" />
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
        <div className={`order-page-shell ${matchPageModeClass}`}>
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
                                    {chatEnabled ? "Live chat enabled" : "Chat unavailable"}
                                </span>
                            </div>

                            <div className="chat-messages-shell">
                                <div className="chat-messages" ref={chatMessagesRef}>
                                    {messages.map((message, index) => {
                                        const previousMessage = index > 0 ? messages[index - 1] : null;
                                        const shouldShowDateDivider = shouldRenderDateDivider(previousMessage, message);

                                        const isMine = message.isMine || message.sender === "mine";
                                        const isSystem = message.sender === "system";
                                        const showAvatar = !isMine && !isSystem;

                                        return (
                                            <div key={message.id} data-message-id={message.id}>
                                                {shouldShowDateDivider && (
                                                    <div className="chat-date-divider">
                                                        <span>{formatChatDateDivider(message.createdAt)}</span>
                                                    </div>
                                                )}

                                                <div
                                                    className={`chat-row ${isMine ? "chat-row-mine" : isSystem ? "chat-row-system" : "chat-row-other"}`}
                                                >
                                                    {showAvatar && (
                                                        <div className="chat-avatar-wrap">
                                                            <img
                                                                src={message.senderAvatar || getSenderAvatar(message.senderUser)}
                                                                alt={message.senderName || "Sender"}
                                                                className="chat-message-avatar"
                                                            />
                                                            <span className="chat-avatar-online-dot" />
                                                        </div>
                                                    )}

                                                    <div
                                                        className={`chat-message ${isMine ? "chat-message-mine" : isSystem ? "chat-message-system" : "chat-message-other"}`}
                                                    >
                                                        <div className="chat-message-top">
                                                            <span className="chat-sender">
                                                                {getMessageSenderName(message, matchedBooster)}
                                                            </span>

                                                            <span className="chat-timestamp">
                                                                {message.timestamp || "3:37 PM"}
                                                            </span>
                                                        </div>

                                                        <p>{message.text}</p>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                {scrollThumb.visible && (
                                    <div className="custom-chat-scrollbar" aria-hidden="true">
                                        <div
                                            className="custom-chat-scrollbar-thumb"
                                            style={{
                                                height: `${scrollThumb.height}px`,
                                                transform: `translateY(${scrollThumb.top}px)`,
                                            }}
                                        />
                                    </div>
                                )}
                            </div>

                            <form
                                className={`chat-composer ${!chatEnabled ? "chat-composer-disabled" : ""}`}
                                onSubmit={handleSendMessage}
                            >
                                <button
                                    type="button"
                                    className="chat-attach-btn"
                                    aria-label="Attach file"
                                    title="Attachment coming soon"
                                    disabled={!chatEnabled}
                                >
                                    <AttachIcon />
                                </button>

                                <input
                                    type="text"
                                    className="chat-composer-input"
                                    placeholder={
                                        chatEnabled
                                            ? "Write a message..."
                                            : "Chat is unavailable until this order conversation loads"
                                    }
                                    value={chatInput}
                                    onChange={(event) => setChatInput(event.target.value)}
                                    disabled={!chatEnabled}
                                />

                                <button
                                    type="submit"
                                    className="chat-send-btn"
                                    disabled={!chatEnabled || !chatInput.trim()}
                                    aria-label="Send message"
                                    title="Send"
                                >
                                    <SendIcon />
                                </button>
                            </form>
                        </div>

                        <div className="match-options-card order-extras-card">
                            <div className="match-card-header premium-card-header">
                                <div className="match-card-icon">⚙</div>

                                <div>
                                    <h3>Order Options</h3>
                                    <p>Active extras on your boost</p>
                                </div>
                            </div>

                            {getEnabledOrderOptions(order).length > 0 ? (
                                <div className="order-options-grid">
                                    {getEnabledOrderOptions(order).map((option) => (
                                        <div className="order-option-pill" key={option.label}>
                                            <span className={`order-option-icon ${option.iconClass || ""}`}>
                                                {option.icon}
                                            </span>

                                            <div className="order-option-text">
                                                <strong>{option.label}</strong>
                                                <small>{option.description}</small>
                                            </div>

                                            <span className="option-active-badge">ACTIVE</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="empty-option-text">
                                    No extra options selected for this order.
                                </p>
                            )}
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

                        <div className="match-side-card login-info-card">
                            <div className="login-card-header">
                                <div className="match-card-icon login-card-icon">
                                    <KeyIcon />
                                </div>

                                <div className="login-card-title-wrap">
                                    <h3>Login Info</h3>
                                    <p>
                                        {canEditLoginInfo
                                            ? "Update your in-game access details"
                                            : "Secure order access details"}
                                    </p>
                                </div>

                                {canEditLoginInfo && (
                                    <button
                                        type="button"
                                        className="login-edit-btn"
                                        onClick={openLoginInfoModal}
                                    >
                                        Edit
                                    </button>
                                )}
                            </div>

                            <div className="login-info-list">
                                <div className="login-info-item">
                                    <div className="login-info-left">
                                        <span className="login-field-icon">
                                            <UserFieldIcon />
                                        </span>

                                        <div className="login-info-copy">
                                            <small>In-game name</small>
                                            <strong>{inGameName}</strong>
                                        </div>
                                    </div>
                                </div>

                                {needsAccountPassword && (
                                    <div className="login-info-item">
                                        <div className="login-info-left">
                                            <span className="login-field-icon">
                                                <LockFieldIcon />
                                            </span>

                                            <div className="login-info-copy">
                                                <small>Password</small>
                                                <strong>{displayedPassword}</strong>
                                            </div>
                                        </div>

                                        {loginPassword && (
                                            <button
                                                type="button"
                                                className="login-reveal-btn"
                                                onClick={() => setShowLoginPassword((prev) => !prev)}
                                            >
                                                {showLoginPassword ? "Hide" : "Reveal"}
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="match-options-card order-overview-card">
                            <div className="match-card-header premium-card-header">
                                <div className="match-card-icon">◉</div>

                                <div>
                                    <h3>Overview</h3>
                                    <p>Quick details about your order</p>
                                </div>
                            </div>

                            <div className="order-overview-grid sidebar-overview-grid">
                                <div className="overview-pill">
                                    <span className="overview-icon">≡</span>
                                    <div>
                                        <small>Queue</small>
                                        <strong>{order.queueType || "-"}</strong>
                                    </div>
                                </div>

                                <div className="overview-pill">
                                    <span className="overview-icon region-icon">
                                        <GlobeIcon />
                                    </span>
                                    <div>
                                        <small>Region</small>
                                        <strong>{order.region || "-"}</strong>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </aside>
                </div>
            </div>
            {showLoginInfoModal && (
                <div className="login-info-modal-backdrop">
                    <form className="login-info-modal" onSubmit={handleSaveLoginInfo}>
                        <div className="login-info-modal-header">
                            <div>
                                <h3>Edit Login Info</h3>
                                <p>Only you, admin, and the assigned booster can view this.</p>
                            </div>

                            <button
                                type="button"
                                className="login-info-modal-close"
                                onClick={() => setShowLoginInfoModal(false)}
                            >
                                ×
                            </button>
                        </div>

                        {loginInfoError && (
                            <p className="login-info-error">{loginInfoError}</p>
                        )}

                        <label className="login-info-form-field">
                            <span>In-game name</span>
                            <input
                                type="text"
                                value={loginInfoForm.inGameName}
                                onChange={(event) =>
                                    setLoginInfoForm((prev) => ({
                                        ...prev,
                                        inGameName: event.target.value,
                                    }))
                                }
                                placeholder="Example: Starlight#AURA"
                            />
                        </label>

                        {needsAccountPassword && (
                            <label className="login-info-form-field">
                                <span>Password</span>
                                <input
                                    type="password"
                                    value={loginInfoForm.accountPassword}
                                    onChange={(event) =>
                                        setLoginInfoForm((prev) => ({
                                            ...prev,
                                            accountPassword: event.target.value,
                                        }))
                                    }
                                    placeholder={order?.hasAccountPassword ? "Leave blank to keep current password" : "Enter account password"}
                                />
                            </label>
                        )}

                        <div className="login-info-modal-actions">
                            <button
                                type="button"
                                className="login-info-cancel-btn"
                                onClick={() => setShowLoginInfoModal(false)}
                            >
                                Cancel
                            </button>

                            <button
                                type="submit"
                                className="login-info-save-btn"
                                disabled={loginInfoSaving}
                            >
                                {loginInfoSaving ? "Saving..." : "Save"}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}

function MatchPageSkeleton() {
    return (
        <div className="match-loading-page">
            <section className="match-loading-hero skeleton-card">
                <div className="skeleton-line skeleton-eyebrow" />
                <div className="skeleton-line skeleton-title" />
                <div className="skeleton-line skeleton-subtitle" />
            </section>

            <div className="match-loading-tabs">
                <div className="skeleton-pill" />
                <div className="skeleton-pill skeleton-pill-short" />
            </div>

            <div className="match-loading-layout">
                <section className="match-loading-main">
                    <div className="match-loading-chat skeleton-card">
                        <div className="match-loading-chat-header">
                            <div className="skeleton-avatar" />
                            <div>
                                <div className="skeleton-line skeleton-name" />
                                <div className="skeleton-line skeleton-small" />
                            </div>
                            <div className="skeleton-pill skeleton-pill-status" />
                        </div>

                        <div className="match-loading-message skeleton-message-left">
                            <div className="skeleton-avatar skeleton-avatar-sm" />
                            <div className="skeleton-bubble">
                                <div className="skeleton-line skeleton-bubble-line-lg" />
                                <div className="skeleton-line skeleton-bubble-line-md" />
                            </div>
                        </div>

                        <div className="match-loading-message skeleton-message-right">
                            <div className="skeleton-bubble skeleton-bubble-right">
                                <div className="skeleton-line skeleton-bubble-line-md" />
                                <div className="skeleton-line skeleton-bubble-line-sm" />
                            </div>
                        </div>

                        <div className="match-loading-message skeleton-message-left">
                            <div className="skeleton-avatar skeleton-avatar-sm" />
                            <div className="skeleton-bubble">
                                <div className="skeleton-line skeleton-bubble-line-lg" />
                                <div className="skeleton-line skeleton-bubble-line-sm" />
                            </div>
                        </div>

                        <div className="match-loading-composer">
                            <div className="skeleton-circle-btn" />
                            <div className="skeleton-input" />
                            <div className="skeleton-circle-btn" />
                        </div>
                    </div>

                    <div className="match-loading-options skeleton-card">
                        <div className="skeleton-line skeleton-section-title" />
                        <div className="match-loading-option-grid">
                            <div className="skeleton-option-pill" />
                            <div className="skeleton-option-pill" />
                            <div className="skeleton-option-pill" />
                            <div className="skeleton-option-pill" />
                        </div>
                    </div>
                </section>

                <aside className="match-loading-sidebar">
                    <div className="skeleton-card match-loading-side-card">
                        <div className="skeleton-avatar skeleton-avatar-lg" />
                        <div className="skeleton-line skeleton-name-wide" />
                        <div className="skeleton-line skeleton-small-wide" />
                        <div className="skeleton-line skeleton-small-wide-2" />
                    </div>

                    <div className="skeleton-card match-loading-side-card">
                        <div className="skeleton-line skeleton-section-title" />
                        <div className="skeleton-option-pill" />
                        <div className="skeleton-option-pill" />
                    </div>

                    <div className="skeleton-card match-loading-side-card">
                        <div className="skeleton-line skeleton-section-title" />
                        <div className="skeleton-option-pill" />
                        <div className="skeleton-option-pill" />
                    </div>
                </aside>
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

function getCurrentUserId(currentUser) {
    return (
        currentUser?.id ||
        currentUser?.userId ||
        currentUser?._id ||
        currentUser?.sub ||
        null
    );
}

function getStoredUser() {
    try {
        return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
        return null;
    }
}

function isUserInConversation(conversation, currentUserId) {
    if (!conversation || !currentUserId) return false;

    const participants = conversation.participants || [];

    return participants.some((participant) => {
        const participantUser = participant?.user || participant?.booster || participant;

        const participantUserId =
            participant?.userId ||
            participantUser?.id ||
            participantUser?.userId ||
            participantUser?._id ||
            participantUser?.sub;

        return String(participantUserId || "") === String(currentUserId || "");
    });
}

function isUserAssignedToOrder(order, conversation, currentUserId) {
    if (!currentUserId) return false;

    const assignments = order?.assignments || order?.orderAssignments || [];

    const assignedFromOrder = assignments.some((assignment) => {
        const boosterId =
            assignment?.boosterId ||
            assignment?.providerId ||
            assignment?.userId ||
            assignment?.booster?.id ||
            assignment?.provider?.id ||
            assignment?.user?.id;

        return String(boosterId || "") === String(currentUserId || "");
    });

    if (assignedFromOrder) return true;

    const participants = conversation?.participants || [];

    const assignedFromConversation = participants.some((participant) => {
        const participantUser = participant?.user || participant?.booster || participant;

        const participantUserId =
            participant?.userId ||
            participantUser?.id ||
            participantUser?.userId;

        const participantRole = String(
            participant?.roleAtJoin ||
            participantUser?.role ||
            ""
        ).toUpperCase();

        return (
            String(participantUserId || "") === String(currentUserId || "") &&
            (participantRole === "PROVIDER" || participantRole === "BOOSTER")
        );
    });

    return assignedFromConversation;
}

function getMessageSenderName(message, matchedBooster) {
    if (message.isMine) return "You";

    if (message.senderName) return message.senderName;

    if (message.senderRole === "ADMIN") return "Admin";

    if (message.senderRole === "PROVIDER") {
        return getBoosterDisplayName(matchedBooster);
    }

    if (message.senderRole === "CUSTOMER") return "Customer";

    return "System";
}

function getSenderDisplayName(sender) {
    return (
        sender?.username ||
        sender?.profile?.displayName ||
        sender?.email?.split("@")[0] ||
        "User"
    );
}

function getSenderAvatar(sender) {
    const name = getSenderDisplayName(sender);

    return (
        sender?.profileImage ||
        sender?.avatar ||
        sender?.profile?.profileImage ||
        sender?.profile?.avatar ||
        sender?.profile?.photoUrl ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=111827&color=fff`
    );
}

function getEnabledOrderOptions(order) {
    if (!order) return [];

    const options = [];

    if (order.duoWithBooster) {
        options.push({
            label: "Play with booster",
            description: "Duo session with assigned provider",
            icon: "👥",
            iconClass: "option-icon-duo",
        });
    }

    if (order.priorityOrder) {
        options.push({
            label: "Priority order",
            description: "Higher priority in the queue",
            icon: "⚡",
            iconClass: "option-icon-priority",
        });
    }

    if (order.liveStream) {
        options.push({
            label: "Live stream",
            description: "Watch progress live when available",
            icon: "●",
            iconClass: "option-icon-live",
        });
    }

    if (order.appearOffline) {
        options.push({
            label: "Appear offline",
            description: "Provider keeps offline mode enabled",
            icon: <EyeOffIcon />,
            iconClass: "option-icon-offline",
        });
    }

    if (order.bonusWin) {
        options.push({
            label: "Bonus win",
            description: "Extra win added to the order",
            icon: "+",
            iconClass: "option-icon-bonus",
        });
    }

    if (order.soloOnly) {
        options.push({
            label: "Solo only",
            description: "No duo queue during the boost",
            icon: "♟",
            iconClass: "option-icon-solo",
        });
    }

    if (order.highMMRDuo) {
        options.push({
            label: "High MMR Duo",
            description: "High MMR duo handling enabled",
            icon: "▲",
            iconClass: "option-icon-highmmr",
        });
    }

    return options;
}

function EyeOffIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="option-svg-icon"
            aria-hidden="true"
        >
            <path d="M3 3l18 18" />
            <path d="M10.7 10.7a2 2 0 002.6 2.6" />
            <path d="M9.6 5.2A8.7 8.7 0 0112 4.9c4.8 0 8 4.6 8.9 6.1a1.6 1.6 0 010 1.9 15.2 15.2 0 01-3 3.5" />
            <path d="M6.5 6.6A15.5 15.5 0 003.1 11a1.6 1.6 0 000 1.9c.9 1.5 4.1 6.1 8.9 6.1 1.2 0 2.4-.3 3.5-.8" />
        </svg>
    );
}

function GlobeIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="option-svg-icon"
            aria-hidden="true"
        >
            <circle cx="12" cy="12" r="8.5" />
            <path d="M3.8 12h16.4" />
            <path d="M12 3.5c2.4 2.2 3.8 5.3 3.8 8.5s-1.4 6.3-3.8 8.5c-2.4-2.2-3.8-5.3-3.8-8.5s1.4-6.3 3.8-8.5z" />
        </svg>
    );
}

function shouldRenderDateDivider(previousMessage, currentMessage) {
    if (!currentMessage?.createdAt) return false;
    if (!previousMessage?.createdAt) return true;

    const previousDate = new Date(previousMessage.createdAt);
    const currentDate = new Date(currentMessage.createdAt);

    return previousDate.toDateString() !== currentDate.toDateString();
}

function formatChatDateDivider(value) {
    if (!value) return "";

    const messageDate = new Date(value);
    const today = new Date();

    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (messageDate.toDateString() === today.toDateString()) {
        return "Today";
    }

    if (messageDate.toDateString() === yesterday.toDateString()) {
        return "Yesterday";
    }

    return messageDate.toLocaleDateString([], {
        month: "short",
        day: "2-digit",
        year: "numeric",
    });
}

function AttachIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="composer-svg-icon"
            aria-hidden="true"
        >
            <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
    );
}

function SendIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            className="composer-svg-icon composer-send-icon"
            aria-hidden="true"
        >
            <path d="M3.7 20.3 21 12 3.7 3.7 3 10.2l10 1.8-10 1.8.7 6.5Z" />
        </svg>
    );
}

function requiresAccountPassword(order) {
    if (!order) return false;

    // Best version: backend gives you a clear boolean
    if (typeof order.requiresAccountCredentials === "boolean") {
        return order.requiresAccountCredentials;
    }

    // Frontend fallback logic
    if (order.boostType === "Pro Duo") return false;
    if (order.duoWithBooster) return false;

    return true;
}

function maskSecret(value) {
    if (!value) return "-";
    return "•".repeat(Math.max(8, value.length));
}

function KeyIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="option-svg-icon"
            aria-hidden="true"
        >
            <circle cx="7.5" cy="15.5" r="3.5" />
            <path d="M10.5 13l8-8" />
            <path d="M15 5l4 4" />
            <path d="M17 7l-2 2" />
            <path d="M19 9l-2 2" />
        </svg>
    );
}

function UserFieldIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="option-svg-icon"
            aria-hidden="true"
        >
            <path d="M20 21a8 8 0 0 0-16 0" />
            <circle cx="12" cy="8" r="4" />
        </svg>
    );
}

function LockFieldIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="option-svg-icon"
            aria-hidden="true"
        >
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V8a4 4 0 1 1 8 0v3" />
        </svg>
    );
}

export default MatchPage;