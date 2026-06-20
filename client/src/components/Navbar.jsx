import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import CleanIcon from "./CleanIcon";
import {
    listMyNotifications,
    markAllNotificationsRead,
    markAllChatNotificationsRead,
} from "../api/notifications";
import {
    acceptAssignmentRequest,
    declineAssignmentRequest,
} from "../api/assignmentRequests";
import {
    clearExpiredSession,
    clearLoggedOutSession,
    getStoredUser,
    hasValidSession,
    notifyAuthChanged,
    notifyUnreadChanged,
    scheduleSessionExpiryCheck,
} from "../utils/authSession";

function Navbar({
    hasSession,
    currentUser,
    profileImage,
    showProfileMenu,
    setShowProfileMenu,
    setAuthMode,
    setAuthMessage,
    setAuthSuccess,
    setLoginErrors,
    setRegisterErrors,
    setForgotError,
    setForgotEmail,
    setShowAuthModal,
    handleLogout,
}) {

    const location = useLocation();
    const navigate = useNavigate();

    const [localHasSession, setLocalHasSession] = useState(() => hasValidSession());

    const [localCurrentUser, setLocalCurrentUser] = useState(() => {
        if (!hasValidSession()) return null;
        return getStoredUser();
    });

    const [localShowProfileMenu, setLocalShowProfileMenu] = useState(false);
    const [notifications, setNotifications] = useState([]);
    const [messageNotifications, setMessageNotifications] = useState([]);
    const [profileImageLoading, setProfileImageLoading] = useState(false);
    const [notificationsLoading, setNotificationsLoading] = useState(false);
    const [notificationsError, setNotificationsError] = useState("");
    const [unreadMessages, setUnreadMessages] = useState(0);
    const [unreadNotifications, setUnreadNotifications] = useState(0);
    const [openPanel, setOpenPanel] = useState(null); // 'notifications' | 'messages' | null
    const [isPanelClosing, setIsPanelClosing] = useState(false);
    const [panelAnimIn, setPanelAnimIn] = useState(false); // add 'open' class after mount for smooth slide-in

    useEffect(() => {
        let expiryTimerId = scheduleSessionExpiryCheck();

        const resetExpiryTimer = () => {
            if (expiryTimerId) {
                window.clearTimeout(expiryTimerId);
            }

            expiryTimerId = scheduleSessionExpiryCheck();
        };

        const syncNavbarSession = async () => {
            const tokenBeforeCheck = localStorage.getItem("token");
            const tokenIsValid = hasValidSession();

            if (!tokenIsValid) {
                // If there was no token before checking, this is a normal logged-out state,
                // not an expired session.
                setLocalHasSession(false);
                setLocalCurrentUser(null);
                setLocalShowProfileMenu(false);
                setNotifications([]);
                setMessageNotifications([]);
                setUnreadNotifications(0);
                setUnreadMessages(0);
                localStorage.setItem("unreadNotifications", "0");
                localStorage.setItem("unreadMessages", "0");
                setOpenPanel(null);

                // Only expired-token logic should show the modal.
                // hasValidSession() already calls clearExpiredSession() when token exists but expired.
                if (!tokenBeforeCheck) {
                    return;
                }

                return;
            }

            setLocalHasSession(true);
            setLocalCurrentUser(getStoredUser());
            resetExpiryTimer();

            const token = localStorage.getItem("token");
            const cached = getStoredUser();

            if (token) {
                try {
                    const res = await fetch("http://localhost:5000/api/user/me", {
                        headers: { Authorization: `Bearer ${token}` },
                    });

                    if (res.status === 401 || res.status === 403) {
                        clearExpiredSession();
                        setLocalHasSession(false);
                        setLocalCurrentUser(null);
                        navigate("/", { replace: true });
                        return;
                    }

                    const data = await res.json();

                    if (res.ok && data?.user) {
                        localStorage.setItem("user", JSON.stringify(data.user));
                        setLocalCurrentUser(data.user);
                    }
                } catch { }
            }
        };

        syncNavbarSession();

        const syncCounts = () => {
            const m = Number(localStorage.getItem("unreadMessages") || 0);
            const n = Number(localStorage.getItem("unreadNotifications") || 0);
            setUnreadMessages(isFinite(m) ? Math.max(0, m) : 0);
            setUnreadNotifications(isFinite(n) ? Math.max(0, n) : 0);
        };

        syncCounts();
        window.addEventListener("storage", syncCounts);
        window.addEventListener("unread:update", syncCounts);

        const handleAuthChanged = (event) => {
            if (expiryTimerId) {
                window.clearTimeout(expiryTimerId);
                expiryTimerId = null;
            }

            if (event.detail?.loggedOut) {
                setLocalHasSession(false);
                setLocalCurrentUser(null);
                setLocalShowProfileMenu(false);
                setNotifications([]);
                setMessageNotifications([]);
                setUnreadNotifications(0);
                setUnreadMessages(0);
                setOpenPanel(null);
                return;
            }

            const updatedUser = event.detail?.user || getStoredUser();

            if (updatedUser) {
                setLocalHasSession(true);
                setLocalCurrentUser(updatedUser);
                expiryTimerId = scheduleSessionExpiryCheck();
                return;
            }

            syncNavbarSession();
        };

        window.addEventListener("storage", syncNavbarSession);
        window.addEventListener("focus", syncNavbarSession);
        window.addEventListener("auth:changed", handleAuthChanged);

        const handleProfileImageUploading = (event) => {
            setProfileImageLoading(Boolean(event.detail?.uploading));
        };

        window.addEventListener("profile-image:uploading", handleProfileImageUploading);

        return () => {
            if (expiryTimerId) {
                window.clearTimeout(expiryTimerId);
            }

            window.removeEventListener("storage", syncNavbarSession);
            window.removeEventListener("focus", syncNavbarSession);
            window.removeEventListener("auth:changed", handleAuthChanged);
            window.removeEventListener("profile-image:uploading", handleProfileImageUploading);
            window.removeEventListener("storage", syncCounts);
            window.removeEventListener("unread:update", syncCounts);
        };
    }, []);

    const effectiveHasSession =
        typeof hasSession === "boolean" ? hasSession : localHasSession;

    const effectiveCurrentUser = currentUser ?? localCurrentUser;

    const effectiveProfileImage =
        profileImage ||
        effectiveCurrentUser?.profile?.profileImageUrl ||
        effectiveCurrentUser?.profileImage ||
        localCurrentUser?.profile?.profileImageUrl ||
        localCurrentUser?.profileImage ||
        "";

    const effectiveShowProfileMenu =
        typeof showProfileMenu === "boolean"
            ? showProfileMenu
            : localShowProfileMenu;

    const effectiveSetShowProfileMenu =
        setShowProfileMenu || setLocalShowProfileMenu;

    const onLogout = () => {
        clearLoggedOutSession();

        setLocalHasSession(false);
        setLocalCurrentUser(null);
        setLocalShowProfileMenu(false);
        setNotifications([]);
        setMessageNotifications([]);
        setUnreadNotifications(0);
        setUnreadMessages(0);
        setOpenPanel(null);

        navigate("/", { replace: true });
    };

    const loadNotifications = async () => {
        const tokenBeforeCheck = localStorage.getItem("token");

        if (!hasValidSession()) {
            // Do not show expired popup if there was no token.
            // That means the user is simply logged out.
            if (!tokenBeforeCheck) {
                setNotifications([]);
                setMessageNotifications([]);
                setUnreadNotifications(0);
                setUnreadMessages(0);
                setLocalHasSession(false);
                setLocalCurrentUser(null);
                localStorage.setItem("unreadNotifications", "0");
                localStorage.setItem("unreadMessages", "0");
                return [];
            }

            setNotifications([]);
            setMessageNotifications([]);
            setUnreadNotifications(0);
            setUnreadMessages(0);
            setLocalHasSession(false);
            setLocalCurrentUser(null);
            localStorage.setItem("unreadNotifications", "0");
            localStorage.setItem("unreadMessages", "0");
            navigate("/", { replace: true });
            return [];
        }

        try {
            setNotificationsLoading(true);
            setNotificationsError("");

            const items = await listMyNotifications();

            const sortedItems = [...items].sort((a, b) => {
                if (a.read !== b.read) return a.read ? 1 : -1;
                return new Date(b.createdAt) - new Date(a.createdAt);
            });

            const normalNotifications = sortedItems.filter(
                (item) => item.type !== "CHAT_MESSAGE"
            );

            const chatNotifications = sortedItems.filter(
                (item) => item.type === "CHAT_MESSAGE"
            );

            const unreadNormalCount = normalNotifications.filter((item) => !item.read).length;
            const unreadChatCount = chatNotifications.filter((item) => !item.read).length;

            setNotifications(normalNotifications);
            setMessageNotifications(chatNotifications);

            setUnreadNotifications(unreadNormalCount);
            setUnreadMessages(unreadChatCount);

            localStorage.setItem("unreadNotifications", String(unreadNormalCount));
            localStorage.setItem("unreadMessages", String(unreadChatCount));

            try {
                notifyUnreadChanged();
            } catch { }

            return sortedItems;
        } catch (error) {
            if (
                error.message?.toLowerCase().includes("unauthorized") ||
                error.message?.toLowerCase().includes("jwt") ||
                error.message?.toLowerCase().includes("token")
            ) {
                clearExpiredSession();
                setLocalHasSession(false);
                setLocalCurrentUser(null);
                navigate("/", { replace: true });
                return [];
            }

            setNotificationsError(error.message || "Failed to load notifications");
            return [];
        } finally {
            setNotificationsLoading(false);
        }
    };

    useEffect(() => {
        if (!effectiveHasSession) {
            setNotifications([]);
            setMessageNotifications([]);
            setUnreadNotifications(0);
            setUnreadMessages(0);
            localStorage.setItem("unreadNotifications", "0");
            localStorage.setItem("unreadMessages", "0");
            return;
        }

        loadNotifications();
    }, [effectiveHasSession]);

    const markNotificationsReadOnClose = async () => {
        try {
            const hasUnread = notifications.some((item) => !item.read);

            if (!hasUnread) return;

            const readItems = await markAllNotificationsRead();

            const sortedReadItems = [...readItems].sort((a, b) => {
                if (a.read !== b.read) return a.read ? 1 : -1;
                return new Date(b.createdAt) - new Date(a.createdAt);
            });

            setNotifications(sortedReadItems);
            setUnreadNotifications(0);
            localStorage.setItem("unreadNotifications", "0");

            try {
                notifyUnreadChanged();
            } catch { }
        } catch (error) {
            console.error("Failed to mark notifications read on close:", error);
        }
    };

    const openSidePanel = (kind) => {
        setIsPanelClosing(false);
        setOpenPanel(kind);

        setPanelAnimIn(false);
        effectiveSetShowProfileMenu(false);

        setTimeout(() => setPanelAnimIn(true), 20);

        try {
            const sbw = window.innerWidth - document.documentElement.clientWidth;
            document.body.classList.add("lock-scroll");
            if (sbw > 0) document.body.style.paddingRight = `${sbw}px`;
        } catch { }
    };

    const closeSidePanel = () => {
        const closingPanel = openPanel;

        setIsPanelClosing(true);
        setPanelAnimIn(false);

        setTimeout(async () => {
            if (closingPanel === "notifications") {
                await markNotificationsReadOnClose();
            }

            if (closingPanel === "messages") {
                try {
                    await markAllChatNotificationsRead();

                    setMessageNotifications((prev) =>
                        prev.map((item) => ({ ...item, read: true }))
                    );

                    setUnreadMessages(0);
                    localStorage.setItem("unreadMessages", "0");

                    notifyUnreadChanged();
                } catch (error) {
                    console.error("Failed to mark chat notifications read:", error);
                }
            }

            setOpenPanel(null);
            setIsPanelClosing(false);

            document.body.classList.remove("lock-scroll");
            document.body.style.paddingRight = "";
        }, 180);
    };

    useEffect(() => {
        const onKey = (e) => {
            if (e.key === 'Escape' && openPanel) closeSidePanel();
        };
        if (openPanel) window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [openPanel]);

    useEffect(() => {
        if (openPanel !== "notifications" && openPanel !== "messages") return;

        loadNotifications();
    }, [openPanel]);

    const displayName =
        effectiveCurrentUser?.username ||
        effectiveCurrentUser?.profile?.displayName ||
        (effectiveCurrentUser?.email ? effectiveCurrentUser.email.split("@")[0] : "");

    return (
        <header className="topbar">
            <div className="brand">
                <Link to="/" className="brand-link">
                    <div className="brand-icon brand-logo-image-wrap">
                        <CleanIcon
                            src="https://fastboost-assets.s3.ca-central-1.amazonaws.com/logos/fastboost-logo.png"
                            alt="FastBoost logo"
                            className="brand-logo-image"
                        />
                    </div>

                    <div>
                        <p className="brand-title">FastBoost</p>
                        <p className="brand-subtitle">League Services Platform</p>
                    </div>
                </Link>
            </div>

            <nav className="nav">

                {!effectiveHasSession ? (
                    <button
                        className="nav-cta"
                        onClick={() => {
                            if (
                                setAuthMode &&
                                setAuthMessage &&
                                setAuthSuccess &&
                                setLoginErrors &&
                                setRegisterErrors &&
                                setForgotError &&
                                setForgotEmail &&
                                setShowAuthModal
                            ) {
                                setAuthMode("login");
                                setAuthMessage("");
                                setAuthSuccess(false);
                                setLoginErrors({ email: false, password: false });
                                setRegisterErrors({ email: false, password: false });
                                setForgotError(false);
                                setForgotEmail("");
                                setShowAuthModal(true);
                            } else {
                                navigate("/login", {
                                    state: { from: location.pathname + location.search },
                                });
                            }
                        }}
                    >
                        <span className="nav-login-icon" aria-hidden>
                            <svg viewBox="0 0 24 24" fill="none">
                                <path
                                    d="M10 7L15 12L10 17"
                                    stroke="currentColor"
                                    strokeWidth="2.2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                                <path
                                    d="M15 12H3"
                                    stroke="currentColor"
                                    strokeWidth="2.2"
                                    strokeLinecap="round"
                                />
                                <path
                                    d="M13 4H18C19.6569 4 21 5.34315 21 7V17C21 18.6569 19.6569 20 18 20H13"
                                    stroke="currentColor"
                                    strokeWidth="2.2"
                                    strokeLinecap="round"
                                />
                            </svg>
                        </span>
                        <span>Login</span>
                    </button>
                ) : (
                    <div
                        className="profile-menu-wrap"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="profile-identity" title={displayName || effectiveCurrentUser?.email || "Profile"}>
                            <span className="profile-username-ellipsis">{displayName}</span>
                            <button
                                className={`profile-avatar-btn ${profileImageLoading ? "avatar-loading" : ""}`}
                                onClick={() => effectiveSetShowProfileMenu((prev) => !prev)}
                                aria-haspopup="menu"
                                aria-expanded={effectiveShowProfileMenu}
                                disabled={profileImageLoading}
                            >
                                {effectiveProfileImage ? (
                                    <img
                                        src={effectiveProfileImage}
                                        alt="User profile"
                                        className="profile-avatar-image"
                                    />
                                ) : (
                                    <span className="default-avatar-icon">👤</span>
                                )}
                            </button>
                        </div>

                        {effectiveShowProfileMenu && (
                            <div className="profile-menu profile-menu-expanded" role="menu">
                                <div className="profile-quick-grid">
                                    <button
                                        className={`quick-tile notification-tile ${unreadNotifications > 0 ? "has-notifications" : ""}`}
                                        role="menuitem"
                                        aria-label="Notifications"
                                        title="Notifications"
                                        onClick={() => openSidePanel("notifications")}
                                    >
                                        <span className="quick-icon" aria-hidden>
                                            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                <path
                                                    d="M12 3a6 6 0 0 0-6 6v3.764c0 .536-.214 1.05-.595 1.43L4 15.6V17h16v-1.4l-1.405-1.406A2.02 2.02 0 0 1 18 12.764V9a6 6 0 0 0-6-6Z"
                                                    stroke="currentColor"
                                                    strokeWidth="1.8"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                />
                                                <path
                                                    d="M10 17a2 2 0 0 0 4 0"
                                                    stroke="currentColor"
                                                    strokeWidth="1.8"
                                                    strokeLinecap="round"
                                                />
                                            </svg>
                                        </span>

                                        {unreadNotifications > 0 && <span className="quick-soft-dot notification" />}
                                    </button>

                                    <button
                                        className={`quick-tile message-tile ${unreadMessages > 0 ? "has-messages" : ""}`}
                                        role="menuitem"
                                        aria-label="Messages"
                                        title="Messages"
                                        onClick={() => openSidePanel("messages")}
                                    >
                                        <span className="quick-icon" aria-hidden>
                                            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                <path
                                                    d="M21 14a4 4 0 0 1-4 4H9l-4 3v-3H5a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v7Z"
                                                    stroke="currentColor"
                                                    strokeWidth="1.8"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                />
                                                <path
                                                    d="M7 8h10M7 11h7"
                                                    stroke="currentColor"
                                                    strokeWidth="1.8"
                                                    strokeLinecap="round"
                                                />
                                            </svg>
                                        </span>

                                        {unreadMessages > 0 && <span className="quick-soft-dot message" />}
                                    </button>
                                </div>

                                <button
                                    className="profile-menu-item profile-menu-row"
                                    role="menuitem"
                                    onClick={() => {
                                        effectiveSetShowProfileMenu(false);
                                        navigate("/account/dashboard");
                                    }}
                                >
                                    <ProfileMenuIcon type="dashboard" />
                                    <span>Dashboard</span>
                                </button>

                                {effectiveCurrentUser?.role === "ADMIN" && (
                                    <button
                                        className="profile-menu-item profile-menu-row"
                                        role="menuitem"
                                        onClick={() => {
                                            effectiveSetShowProfileMenu(false);
                                            navigate("/admin/management");
                                        }}
                                    >
                                        <ProfileMenuIcon type="management" />
                                        <span>Management Utilities</span>
                                    </button>
                                )}

                                <button
                                    className="profile-menu-item profile-menu-row"
                                    role="menuitem"
                                    onClick={() => {
                                        effectiveSetShowProfileMenu(false);
                                        navigate(
                                            effectiveCurrentUser?.role === "PROVIDER"
                                                ? "/provider/orders"
                                                : "/account/orders"
                                        );
                                    }}
                                >
                                    <ProfileMenuIcon type="orders" />
                                    <span>
                                        {effectiveCurrentUser?.role === "PROVIDER"
                                            ? "Assigned Orders"
                                            : "Orders"}
                                    </span>
                                </button>

                                <button
                                    className="profile-menu-item profile-menu-row"
                                    role="menuitem"
                                    onClick={() => {
                                        effectiveSetShowProfileMenu(false);
                                        navigate("/account/settings");
                                    }}
                                >
                                    <ProfileMenuIcon type="profile" />
                                    <span>Profile</span>
                                </button>

                                <button
                                    className="profile-menu-item profile-menu-row logout-row"
                                    onClick={onLogout}
                                    role="menuitem"
                                >
                                    <ProfileMenuIcon type="logout" />
                                    <span>Logout</span>
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </nav>

            {/* Right-side sliding panel */}
            {openPanel && (
                <div className={`slide-panel-backdrop ${isPanelClosing ? 'closing' : (panelAnimIn ? 'open' : '')}`} onClick={closeSidePanel}>
                    <aside
                        className={`slide-panel ${isPanelClosing ? 'closing' : (panelAnimIn ? 'open' : '')}`}
                        role="dialog"
                        aria-label={openPanel === 'notifications' ? 'Notifications' : 'Messages'}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="panel-header">
                            <span className={`panel-icon ${openPanel === 'messages' ? 'msg' : 'notif'}`} aria-hidden>
                                {openPanel === 'notifications' ? (
                                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M12 3a6 6 0 0 0-6 6v3.764c0 .536-.214 1.05-.595 1.43L4 15.6V17h16v-1.4l-1.405-1.406A2.02 2.02 0 0 1 18 12.764V9a6 6 0 0 0-6-6Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M10 17a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                                    </svg>
                                ) : (
                                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M21 14a4 4 0 0 1-4 4H9l-4 3v-3H5a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v7Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M7 8h10M7 11h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                                    </svg>
                                )}
                            </span>
                            <div className="panel-titles">
                                <h3>{openPanel === 'notifications' ? 'Notifications' : 'Messages'}</h3>
                                <p className="panel-sub">
                                    {openPanel === "notifications"
                                        ? unreadNotifications > 0
                                            ? `${unreadNotifications} new notification${unreadNotifications === 1 ? "" : "s"}`
                                            : "No new notifications"
                                        : unreadMessages > 0
                                            ? `${unreadMessages} new message${unreadMessages === 1 ? "" : "s"}`
                                            : "No new messages"}
                                </p>
                            </div>
                            <button className="panel-close" aria-label="Close" onClick={closeSidePanel}>×</button>
                        </div>

                        <div className="panel-body">
                            {openPanel === "notifications" ? (
                                <NotificationPanelContent
                                    notifications={notifications}
                                    loading={notificationsLoading}
                                    error={notificationsError}
                                    onRefresh={loadNotifications}
                                    onClosePanel={closeSidePanel}
                                />
                            ) : (
                                <MessagePanelContent
                                    messages={messageNotifications}
                                    onClosePanel={closeSidePanel}
                                />
                            )}
                        </div>
                    </aside>
                </div>
            )}
        </header>
    );
}

function ProfileMenuIcon({ type }) {
    if (type === "dashboard") {
        return (
            <span className="profile-menu-icon" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none">
                    <path d="M4 4h7v7H4V4ZM13 4h7v7h-7V4ZM4 13h7v7H4v-7ZM13 13h7v7h-7v-7Z" stroke="currentColor" strokeWidth="1.8" />
                </svg>
            </span>
        );
    }

    if (type === "management") {
        return (
            <span className="profile-menu-icon" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none">
                    <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M19.4 15a8.1 8.1 0 0 0 .1-1 8.1 8.1 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.8-1L15 5.5h-4l-.3 2.6a8 8 0 0 0-1.8 1l-2.4-1-2 3.4 2 1.5a8.1 8.1 0 0 0-.1 1c0 .3 0 .7.1 1l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 1.8 1l.3 2.6h4l.3-2.6a8 8 0 0 0 1.8-1l2.4 1 2-3.4-2.1-1.5Z" stroke="currentColor" strokeWidth="1.5" />
                </svg>
            </span>
        );
    }

    if (type === "orders") {
        return (
            <span className="profile-menu-icon" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none">
                    <path d="M7 4h13l-2 10H8L7 4ZM7 4H4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM17 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" stroke="currentColor" strokeWidth="1.8" />
                </svg>
            </span>
        );
    }

    if (type === "profile") {
        return (
            <span className="profile-menu-icon" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none">
                    <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M4 21a8 8 0 0 1 16 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
            </span>
        );
    }

    return (
        <span className="profile-menu-icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none">
                <path d="M10 7 5 12l5 5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M5 12h11" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
                <path d="M13 4h4a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
            </svg>
        </span>
    );
}

function NotificationPanelContent({ notifications, loading, error, onRefresh, onClosePanel }) {
    if (loading) {
        return (
            <div className="panel-empty">
                <h4 className="panel-empty-title">Loading notifications...</h4>
                <p className="panel-empty-sub">Checking your latest updates</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="panel-empty">
                <h4 className="panel-empty-title">Could not load notifications</h4>
                <p className="panel-empty-sub">{error}</p>
            </div>
        );
    }

    if (!notifications.length) {
        return (
            <div className="panel-empty">
                <div className="panel-illustration" aria-hidden>
                    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="12" cy="12" r="10.5" fill="rgba(255,255,255,0.08)" />
                        <g transform="translate(12 12) scale(0.82) translate(-12 -12)">
                            <path d="M12 5a5 5 0 0 0-5 5v2.9c0 .42-.17.82-.47 1.12L5 15.5V17h14v-1.5l-1.53-1.48a1.6 1.6 0 0 1-.47-1.12V10a5 5 0 0 0-5-5Z" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M10.5 17a1.5 1.5 0 0 0 3 0" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" />
                        </g>
                    </svg>
                </div>
                <h4 className="panel-empty-title">No notifications</h4>
                <p className="panel-empty-sub">You're all caught up</p>
            </div>
        );
    }

    return (
        <div className="notification-list">
            {notifications.map((notification) => (
                <NotificationCard
                    key={notification.id}
                    notification={notification}
                    onRefresh={onRefresh}
                    onClosePanel={onClosePanel}
                />
            ))}
        </div>
    );
}

function MessagePanelContent({ messages, onClosePanel }) {
    const navigate = useNavigate();

    if (!messages.length) {
        return (
            <div className="panel-empty">
                <div className="panel-illustration" aria-hidden>
                    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="12" cy="12" r="10.5" fill="rgba(255,255,255,0.08)" />
                        <g transform="translate(12 12) translate(1.0,1.0) scale(0.74) translate(-12 -12)">
                            <path d="M21 14a4 4 0 0 1-4 4H9l-4 3v-3H5a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4v7Z" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M7 8h10M7 11h7" fill="none" stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" />
                        </g>
                    </svg>
                </div>
                <h4 className="panel-empty-title">No messages</h4>
                <p className="panel-empty-sub">You're all caught up</p>
            </div>
        );
    }

    return (
        <div className="notification-list">
            {messages.map((item) => {
                const senderName =
                    item.data?.senderName ||
                    item.title ||
                    "Someone";

                const senderInitial =
                    item.data?.senderInitial ||
                    senderName.charAt(0).toUpperCase();

                const boostTitle =
                    item.data?.boostType ||
                    "Order chat";

                const targetPath =
                    item.data?.targetPath ||
                    (item.data?.orderId ? `/match/${item.data.orderId}` : null);

                return (
                    <button
                        key={item.id}
                        type="button"
                        className={`notification-card message-card chat-preview-card ${item.read ? "" : "unread"}`}
                        onClick={() => {
                            onClosePanel?.();

                            if (targetPath) {
                                navigate(targetPath);
                            }
                        }}
                    >
                        <div className="chat-preview-layout">
                            <div className="chat-preview-avatar" aria-hidden>
                                {senderInitial}
                            </div>

                            <div className="chat-preview-main">
                                <div className="chat-preview-header">
                                    <h4>{senderName}</h4>

                                    {!item.read && <span className="notification-dot" />}
                                </div>

                                <p className="chat-preview-meta">
                                    {boostTitle}
                                    {item.data?.orderNumber
                                        ? ` · Order #${item.data.orderNumber}`
                                        : ""}
                                </p>

                                <p className="chat-preview-message">
                                    {item.message}
                                </p>

                                <span className="notification-time">
                                    {new Date(item.createdAt).toLocaleString()}
                                </span>
                            </div>
                        </div>
                    </button>
                );
            })}
        </div>
    );
}

function NotificationCard({ notification, onRefresh, onClosePanel }) {
    const navigate = useNavigate();
    const [actionLoading, setActionLoading] = useState(false);

    const isAssignmentRequest =
        notification.type === "ASSIGNMENT_REQUEST" &&
        notification.data?.requestId;

    const handleAccept = async () => {
        try {
            setActionLoading(true);

            await acceptAssignmentRequest(notification.data.requestId);
            await onRefresh();

            const orderId = notification.data?.orderId;

            if (orderId) {
                onClosePanel?.();
                navigate(`/match/${orderId}`);
            }
        } catch (error) {
            alert(error.message || "Failed to accept assignment");
        } finally {
            setActionLoading(false);
        }
    };

    const handleDecline = async () => {
        try {
            setActionLoading(true);

            await declineAssignmentRequest(notification.data.requestId);
            await onRefresh();
        } catch (error) {
            alert(error.message || "Failed to decline assignment");
        } finally {
            setActionLoading(false);
        }
    };

    return (
        <div className={`notification-card ${notification.read ? "" : "unread"}`}>
            <div className="notification-card-top">
                <div>
                    <h4>{notification.title}</h4>
                    <p>{notification.message}</p>
                </div>

                {!notification.read && <span className="notification-dot" />}
            </div>

            {isAssignmentRequest && (
                <div className="notification-actions">
                    <button
                        className="notification-action-btn accept"
                        disabled={actionLoading}
                        onClick={handleAccept}
                    >
                        {actionLoading ? "Working..." : "Accept"}
                    </button>

                    <button
                        className="notification-action-btn decline"
                        disabled={actionLoading}
                        onClick={handleDecline}
                    >
                        {actionLoading ? "Working..." : "Decline"}
                    </button>
                </div>
            )}

            <span className="notification-time">
                {new Date(notification.createdAt).toLocaleString()}
            </span>
        </div>
    );
}

export default Navbar;