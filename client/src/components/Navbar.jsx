import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

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

    const [localHasSession, setLocalHasSession] = useState(
        Boolean(localStorage.getItem("token"))
    );

    const [localCurrentUser, setLocalCurrentUser] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    });

    const [localShowProfileMenu, setLocalShowProfileMenu] = useState(false);

    useEffect(() => {
        const syncNavbarSession = () => {
            setLocalHasSession(Boolean(localStorage.getItem("token")));

            try {
                setLocalCurrentUser(JSON.parse(localStorage.getItem("user") || "null"));
            } catch {
                setLocalCurrentUser(null);
            }
        };

        syncNavbarSession();

        window.addEventListener("storage", syncNavbarSession);
        window.addEventListener("focus", syncNavbarSession);

        return () => {
            window.removeEventListener("storage", syncNavbarSession);
            window.removeEventListener("focus", syncNavbarSession);
        };
    }, []);

    const effectiveHasSession =
        typeof hasSession === "boolean" ? hasSession : localHasSession;

    const effectiveCurrentUser = currentUser ?? localCurrentUser;

    const effectiveProfileImage =
        profileImage || localCurrentUser?.profileImage || "";

    const effectiveShowProfileMenu =
        typeof showProfileMenu === "boolean"
            ? showProfileMenu
            : localShowProfileMenu;

    const effectiveSetShowProfileMenu =
        setShowProfileMenu || setLocalShowProfileMenu;

    const onLogout = () => {
        if (handleLogout) {
            try { handleLogout(); } catch {}
        }

        localStorage.removeItem("token");
        localStorage.removeItem("user");
        setLocalHasSession(false);
        setLocalCurrentUser(null);
        setLocalShowProfileMenu(false);
        // Notify other parts of the app and redirect away from protected pages
        try { window.dispatchEvent(new Event("auth:changed")); } catch {}
        navigate("/", { replace: true });
    };

    return (
        <header className="topbar">
            <div className="brand">
                <Link to="/" className="brand-link">
                    <div className="brand-icon">F</div>
                    <div>
                        <p className="brand-title">FastBoost</p>
                        <p className="brand-subtitle">League Services Platform</p>
                    </div>
                </Link>
            </div>

            <nav className="nav">
                <a href="/#home">Home</a>
                <a href="/#services">Services</a>
                <a href="/#patch">Latest Patch</a>
                <a href="/#status">Status</a>
                {effectiveCurrentUser?.role === "ADMIN" && (
                    <Link to="/admin/orders">Admin</Link>
                )}

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
                        Login
                    </button>
                ) : (
                    <div
                        className="profile-menu-wrap"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <button
                            className="profile-avatar-btn"
                            onClick={() => effectiveSetShowProfileMenu((prev) => !prev)}
                            title={effectiveCurrentUser?.email || "Profile"}
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

                        {effectiveShowProfileMenu && (
                            <div className="profile-menu">
                                <p className="profile-menu-email">
                                    {effectiveCurrentUser?.email || "Signed in"}
                                </p>
                                {effectiveCurrentUser?.role === "ADMIN" && (
                                    <Link className="profile-menu-item" to="/admin/orders">Admin Panel</Link>
                                )}
                                <button className="profile-menu-item">My Orders</button>
                                <button className="profile-menu-item">Account Settings</button>
                                <button className="profile-menu-item" onClick={onLogout}>
                                    Logout
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </nav>
        </header>
    );
}

export default Navbar;