import ArrowUpRightIcon from '../components/ArrowUpRightIcon';
import { authStorage } from "../utils/authStorage";
import { storeAuthSession } from "../utils/authStorage";
import { authReturnPath } from "../utils/authReturnPath";
import {
  getStoredUser,
  hasValidSession,
  notifyAuthChanged,
} from "../utils/authSession";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import RegisterPage from "./RegisterPage";
import GameServiceDialog from "../components/GameServiceDialog";
import OpeningCountdown from "../components/OpeningCountdown";
import { API_BASE_URL } from "../api/config";
import { shouldRefreshAvatarData } from '../utils/signedAvatar';
import { orderPathForService, searchWithSelectedGame, selectedGameFromSearch } from '../utils/productRoutes';
import "../styles/HomePage.css";
import "../styles/HomeLanding.css";

const SERVICES_CACHE_KEY = "fastboost:services:v1";
const SERVICE_TITLES_BY_GAME = {
  lol: ["Rank Boost", "Placement Boost", "Win Boost", "Pro Duo"],
  tft: ["TFT Rank Boost", "TFT Win Boost", "TFT Placement Boost"],
};

function getCachedServices() {
  try {
    const raw = localStorage.getItem(SERVICES_CACHE_KEY);

    if (!raw) return null;

    const cached = JSON.parse(raw);

    if (
      !Array.isArray(cached.services) ||
      typeof cached.savedAt !== "number"
    ) {
      return null;
    }

    return cached;
  } catch {
    return null;
  }
}

function saveCachedServices(services) {
  try {
    localStorage.setItem(
      SERVICES_CACHE_KEY,
      JSON.stringify({
        services,
        savedAt: Date.now(),
      })
    );
  } catch {
    // Ignore storage errors
  }
}

function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const loginReturn = useRef(null);
  const { referralCode } = useParams();

  const cachedServices = getCachedServices();

  const [services, setServices] = useState(
    () => cachedServices?.services || []
  );

  const [servicesLoading, setServicesLoading] = useState(
    () => !cachedServices?.services?.length
  );

  const [servicesError, setServicesError] = useState("");
  const selectedGame = selectedGameFromSearch(location.search);
  const [visibleGame, setVisibleGame] = useState(() => selectedGameFromSearch(location.search));
  const [gameSourceElement, setGameSourceElement] = useState(null);

  // Keep the selected game mounted until its return-to-card animation ends.
  if (selectedGame && selectedGame !== visibleGame) setVisibleGame(selectedGame);

  const closeGameServices = useCallback(() => {
    navigate({
      pathname: location.pathname,
      search: searchWithSelectedGame(location.search, ""),
      hash: location.hash,
    }, { replace: true });
  }, [location.pathname, location.search, location.hash, navigate]);

  const finishGameClose = useCallback(() => {
    if (!selectedGame) setVisibleGame("");
  }, [selectedGame]);

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState("login");

  useEffect(() => {
    if (!showAuthModal) {
      document.title = "FastBoost";
      return;
    }

    const authTitles = {
      login: "Sign In | FastBoost",
      register: "Create Account | FastBoost",
      forgot: "Forgot Password | FastBoost",
      "forgot-password": "Forgot Password | FastBoost",
    };

    document.title = authTitles[authMode] || "Account | FastBoost";
  }, [showAuthModal, authMode]);

  const [referralInvite, setReferralInvite] = useState(null);
  const [referralInviteLoading, setReferralInviteLoading] = useState(false);
  const [referralInviteError, setReferralInviteError] = useState("");

  const [loginForm, setLoginForm] = useState({
    email: "",
    password: "",
    rememberMe: false,
  });

  const [registerForm, setRegisterForm] = useState({
    email: "",
    password: "",
    role: "CUSTOMER",
    username: "",
    confirmPassword: "",
    referralCode: referralCode || "",
  });

  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotError, setForgotError] = useState(false);

  const [authLoading, setAuthLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [authSuccess, setAuthSuccess] = useState(false);
  const [authSuccessTitle, setAuthSuccessTitle] = useState("");
  const [authSuccessText, setAuthSuccessText] = useState("");

  const [suspendedModal, setSuspendedModal] = useState({
    open: false,
    reason: "",
  });

  const [loginErrors, setLoginErrors] = useState({
    email: false,
    password: false,
  });

  const [registerErrors, setRegisterErrors] = useState({
    email: false,
    password: false,
  });

  const [currentUser, setCurrentUser] = useState(() => {
    if (!hasValidSession()) return null;
    return getStoredUser();
  });

  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const fallbackImages = [
    "https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1545239351-1141bd82e8a6?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=1200&q=80",
  ];

  const gameOptions = [
    {
      key: "lol",
      title: "League of Legends",
      shortTitle: "LOL",
      description: "Rank boosting, placements, win boosting, and pro duo services.",
      image:
        "/assets/services/lol-card.jpg",
      status: "Available",
    },
    {
      key: "tft",
      title: "Teamfight Tactics",
      shortTitle: "TFT",
      description: "Rank boost, win boost, and placement services for TFT.",
      image:
        "/assets/services/tft-card.jpg",
      status: "Available",
    },
  ];

  const serviceImageMap = {
    "Rank Boost":
      "/assets/services/rank-boost-transparent.png",
    "Placement Boost":
      "/assets/services/placement-boost-transparent.png",
    "Win Boost":
      "/assets/services/win-boost-transparent.png",
    "Pro Duo":
      "/assets/services/pro-duo-transparent.png",
    "TFT Rank Boost":
      "/assets/services/rank-boost-transparent.png",
    "TFT Win Boost":
      "/assets/services/win-boost-transparent.png",
    "TFT Placement Boost":
      "/assets/services/placement-boost-transparent.png",
  };

  useEffect(() => {
    if (!location.state?.openAuthModal && !(location.pathname === '/support' && !hasValidSession())) return;

    // Refresh the target on each login request, even if HomePage is already
    // mounted, and capture it before clearing the transient navigation state.
    loginReturn.current = authReturnPath(location.state?.from);
    setAuthMode(location.state?.authMode || "login");
    setShowAuthModal(true);
    setAuthMessage(
      location.state?.reason === "session-expired"
        ? "Your session expired. Please login again."
        : ""
    );
    setAuthSuccess(false);

    setLoginErrors({
      email: false,
      password: false,
    });

    setRegisterErrors({
      email: false,
      password: false,
    });

    setForgotError(false);
    setForgotEmail("");

    if (location.state) navigate(location.pathname + location.search + location.hash, {
      replace: true,
      state: null,
    });
  }, [location.state, location.pathname, location.search, location.hash, navigate]);

  useEffect(() => {
    if (!referralCode) return;

    let cancelled = false;
    let pending = false;
    let lastRefreshedAt = 0;

    const loadReferralInvite = async (initial = false, force = false) => {
      if (pending || (!initial && !force && !shouldRefreshAvatarData(lastRefreshedAt))) return;
      pending = true;
      if (initial) {
        setReferralInviteLoading(true);
        setReferralInviteError("");
        setRegisterForm((prev) => ({ ...prev, referralCode }));
        setAuthMode("register");
        setShowAuthModal(true);
        setAuthMessage("");
      }

      try {
        const response = await fetch(
          `${API_BASE_URL}/referrals/public/${encodeURIComponent(referralCode)}`
        );

        const data = await response.json();

        if (!response.ok || data.ok === false) {
          throw new Error(data.message || "Could not load private invite.");
        }

        if (!cancelled) {
          setReferralInvite(data.invite || null);
          lastRefreshedAt = Date.now();
        }
      } catch (error) {
        if (!cancelled && initial) {
          setReferralInvite(null);
          setReferralInviteError(error.message || "Could not load private invite.");
        }
      } finally {
        pending = false;
        if (!cancelled && initial) {
          setReferralInviteLoading(false);
        }
      }
    };

    void loadReferralInvite(true);
    const refreshInvite = () => { if (!document.hidden) void loadReferralInvite(); };
    const refreshFailedImage = () => { if (!document.hidden) void loadReferralInvite(false, true); };
    window.addEventListener('focus', refreshInvite);
    window.addEventListener('avatar:refresh', refreshFailedImage);
    document.addEventListener('visibilitychange', refreshInvite);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', refreshInvite);
      window.removeEventListener('avatar:refresh', refreshFailedImage);
      document.removeEventListener('visibilitychange', refreshInvite);
    };
  }, [referralCode]);

  useEffect(() => {
    const controller = new AbortController();

    const fetchServices = async () => {
      const cached = getCachedServices();
      const hasCachedServices = Boolean(cached?.services?.length);

      // Only show skeleton if we have nothing cached.
      if (!hasCachedServices) {
        setServicesLoading(true);
      }

      try {
        const response = await fetch(`${API_BASE_URL}/services`, {
          signal: controller.signal,
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Failed to fetch services");
        }

        const data = await response.json();

        const normalizedServices = Array.isArray(data)
          ? data
          : data.services || [];

        setServices(normalizedServices);
        saveCachedServices(normalizedServices);
        setServicesError("");
      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }

        // Keep showing cached services if the backend is temporarily slow/down.
        if (!hasCachedServices) {
          setServicesError("Could not load services");
        }
      } finally {
        if (!controller.signal.aborted) {
          setServicesLoading(false);
        }
      }
    };

    fetchServices();
    const refresh = () => { if (!document.hidden) void fetchServices(); };
    const timer = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("fastboost:services-updated", refresh);

    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("fastboost:services-updated", refresh);
    };
  }, []);

  useEffect(() => {
    const handleWindowClick = () => {
      setShowProfileMenu(false);
    };

    window.addEventListener("click", handleWindowClick);

    return () => {
      window.removeEventListener("click", handleWindowClick);
    };
  }, []);

  useEffect(() => {
    const handleAuthChanged = (event) => {
      if (event.detail?.loggedOut || event.detail?.sessionExpired) {
        setCurrentUser(null);
        setShowProfileMenu(false);
        return;
      }

      if (event.detail?.user) {
        setCurrentUser(event.detail.user);
      }
    };

    window.addEventListener("auth:changed", handleAuthChanged);

    return () => {
      window.removeEventListener("auth:changed", handleAuthChanged);
    };
  }, []);

  const servicesByTitle = useMemo(() => {
    const servicesByTitleMap = new Map();

    for (const service of services) {
      const matchingServices = servicesByTitleMap.get(service.title);

      if (matchingServices) {
        matchingServices.push(service);
      } else {
        servicesByTitleMap.set(service.title, [service]);
      }
    }

    return servicesByTitleMap;
  }, [services]);

  const featuredServices = useMemo(() => {
    const serviceTitles =
      SERVICE_TITLES_BY_GAME[visibleGame] || SERVICE_TITLES_BY_GAME.lol;
    const matchingServices = [];

    for (const title of serviceTitles) {
      const servicesForTitle = servicesByTitle.get(title);

      if (servicesForTitle) {
        matchingServices.push(...servicesForTitle);
      }
    }

    return matchingServices;
  }, [servicesByTitle, visibleGame]);

  const handleOrderNow = (service) => {
    if (service.active === false) return;
    navigate(orderPathForService(service, services));
  };

  const handleLoginInputChange = (event) => {
    const { name, value, type, checked } = event.target;

    setLoginForm({
      ...loginForm,
      [name]: type === "checkbox" ? checked : value,
    });

    setLoginErrors((prev) => ({
      ...prev,
      [name]: false,
    }));

    setAuthMessage("");
  };

  const handleRegisterInputChange = (event) => {
    const { name, value, type, checked } = event.target;

    setRegisterForm({
      ...registerForm,
      [name]: type === "checkbox" ? checked : value,
    });

    setRegisterErrors((prev) => ({
      ...prev,
      [name]: false,
    }));

    setAuthMessage("");
  };

  const closeAuthModal = () => {
    loginReturn.current = null;
    setShowAuthModal(false);
    setAuthMode("login");
    setAuthLoading(false);
    setAuthMessage("");
    setAuthSuccess(false);
    setAuthSuccessTitle("");
    setAuthSuccessText("");
    setForgotEmail("");
    setForgotError(false);

    setLoginErrors({
      email: false,
      password: false,
    });

    setRegisterErrors({
      email: false,
      password: false,
    });

    setLoginForm({
      email: "",
      password: "",
    });

    setRegisterForm({
      email: "",
      password: "",
      role: "CUSTOMER",
      username: "",
      confirmPassword: "",
      referralCode: referralCode || "",
    });

    if (!referralCode) {
      setReferralInvite(null);
      setReferralInviteLoading(false);
      setReferralInviteError("");
    }
  };

  const handleLogout = () => {
    authStorage.removeItem("token");
    authStorage.removeItem("user");
    setCurrentUser(null);
    setShowProfileMenu(false);
  };

  const finishLogin = ({ token, user, rememberMe = loginForm.rememberMe === true }) => {
    const loggedInUser = {
      ...user,
      profileImage:
        user?.profile?.profileImageUrl ||
        user?.profileImage ||
        user?.avatar ||
        user?.photoUrl ||
        "",
    };

    storeAuthSession(token, loggedInUser, rememberMe);

    setCurrentUser(loggedInUser);

    notifyAuthChanged({
      user: loggedInUser,
    });

    setAuthLoading(false);
    setAuthSuccess(true);
    setAuthMessage("");
    setAuthSuccessTitle("Login Successful");
    setAuthSuccessText("Welcome to FastBoost.");

    setTimeout(() => {
      const returnPath = loginReturn.current;
      closeAuthModal();
      if (returnPath) navigate(returnPath, { replace: true });
    }, 350);
  };

  const handleLoginSubmit = async (event) => {
    event.preventDefault();
    setAuthLoading(true);
    setAuthMessage("");
    setAuthSuccess(false);

    setLoginErrors({
      email: false,
      password: false,
    });

    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(loginForm),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.code === "ACCOUNT_SUSPENDED") {
          setSuspendedModal({
            open: true,
            reason: data.suspendedReason || "This account has been suspended.",
          });

          setLoginErrors({
            email: false,
            password: false,
          });

          setAuthMessage("");
          return;
        }

        setLoginErrors({
          email: true,
          password: true,
        });

        setAuthMessage(data.message || "Incorrect email or password");
        return;
      }

      finishLogin({
        token: data?.token,
        user: {
          ...(data?.user || {}),
          email: data?.user?.email || data?.email || loginForm.email,
          role: data?.user?.role || "CUSTOMER",
        },
      });
    } catch {
      setLoginErrors({
        email: true,
        password: true,
      });
      setAuthMessage("Could not connect to backend");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRegisterSubmit = async (event) => {
    event.preventDefault();
    setAuthLoading(true);
    setAuthMessage("");
    setAuthSuccess(false);

    setRegisterErrors({
      email: false,
      password: false,
    });

    try {
      // Only send expected fields to backend
      const { email, password, role, username, referralCode } = registerForm;

      const registerResponse = await fetch(`${API_BASE_URL}/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          password,
          role,
          username,
          referralCode: referralCode || undefined,
          termsAccepted: registerForm.termsAccepted === true,
          promotionalEmails: registerForm.promotionalEmails === true,
        }),
      });

      const registerData = await registerResponse.json();

      if (!registerResponse.ok) {
        setRegisterErrors({
          email: true,
          password: true,
        });
        setAuthMessage(registerData.message || "Registration failed");
        return;
      }

      if (registerData?.token) {
        finishLogin({
          rememberMe: false,
          token: registerData.token,
          user: {
            ...(registerData.user || {}),
            email: registerData?.user?.email || registerForm.email,
            role: registerData?.user?.role || "CUSTOMER",
          },
        });
        return;
      }

      const loginResponse = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: registerForm.email,
          password: registerForm.password,
        }),
      });

      const loginData = await loginResponse.json();

      if (!loginResponse.ok) {
        setAuthSuccess(true);
        setAuthSuccessTitle("Registration Successful");
        setAuthSuccessText("Your account was created. Please login.");
        setAuthMessage("");

        setTimeout(() => {
          setAuthSuccess(false);
          setAuthMode("login");
          setLoginForm({
            email: registerForm.email,
            password: "",
          });
          setRegisterForm({
            email: "",
            password: "",
            role: "CUSTOMER",
            username: "",
            confirmPassword: "",
            referralCode: referralCode || "",
          });
          setAuthSuccessTitle("");
          setAuthSuccessText("");
        }, 350);

        return;
      }

      finishLogin({
        token: loginData?.token,
        rememberMe: false,
        user: {
          ...(loginData?.user || {}),
          email: loginData?.user?.email || loginData?.email || registerForm.email,
          role: loginData?.user?.role || "CUSTOMER",
        },
      });
    } catch {
      setRegisterErrors({
        email: true,
        password: true,
      });
      setAuthMessage("Could not connect to backend");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleForgotPasswordSubmit = async (event) => {
    event.preventDefault();
    setAuthLoading(true);
    setAuthMessage("");
    setForgotError(false);
    setAuthSuccess(false);

    try {
      const response = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: forgotEmail }),
      });

      const data = await response.json();

      if (!response.ok) {
        setForgotError(true);
        setAuthMessage(data.message || "Could not send reset link");
        return;
      }

      setAuthSuccess(true);
      setAuthSuccessTitle("Reset Link Sent");
      setAuthSuccessText("Check your email for the password reset link.");

      setTimeout(() => {
        closeAuthModal();
      }, 1200);
    } catch {
      setForgotError(true);
      setAuthMessage("Could not connect to backend");
    } finally {
      setAuthLoading(false);
    }
  };

  const hasSession = Boolean(authStorage.getItem("token")) || Boolean(currentUser);

  const profileImage =
    currentUser?.profileImage ||
    currentUser?.avatar ||
    currentUser?.photoUrl ||
    "";

  return (
    <div className="app-shell home-shell">
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
      <main id="home">
        <section className="opening-hero" aria-labelledby="opening-heading">
          <img
            className="opening-hero-art"
            src="/assets/updates/opening-hero.webp"
            alt=""
            fetchPriority="high"
            width="1672"
            height="941"
          />
          <div className="opening-hero-content">
            <h1 id="opening-heading">The next level<br /><span>starts here.</span></h1>
            <OpeningCountdown />
            <Link className="opening-hub-link" to="/hub">
              Explore the Hub <span aria-hidden="true"><ArrowUpRightIcon /></span>
            </Link>
          </div>
        </section>
        <section className="home-arena" aria-labelledby="arena-heading">
          <div className="home-arena-heading">
            <div>
              <p className="home-section-eyebrow">Your game. Your next move.</p>
              <h2 id="arena-heading">Choose your <span>arena.</span></h2>
            </div>
            <p>Select a game to find your service.</p>
          </div>
          <div className="home-game-grid">
            {gameOptions.map((game) => (
              <button
                key={game.key}
                type="button"
                className={`home-game-card home-game-card--${game.key}`}
                aria-label={`Choose a ${game.title} service`}
                aria-haspopup="dialog"
                aria-expanded={selectedGame === game.key}
                onClick={(event) => {
                  setGameSourceElement(event.currentTarget);
                  navigate({
                    pathname: location.pathname,
                    search: searchWithSelectedGame(location.search, game.key),
                    hash: location.hash,
                  });
                }}
              >
                <img src={game.image} alt="" loading="lazy" />
                <span className="home-game-card-content">
                  <span className="home-game-card-copy">
                    <span className="home-game-card-label">{game.key === "lol" ? "Summoner’s Rift" : "The Convergence"}</span>
                    <span className="home-game-card-title">{game.key === "lol" ? <>League of<br />Legends</> : <>Teamfight<br />Tactics</>}</span>
                    <span className="home-game-card-services">{SERVICE_TITLES_BY_GAME[game.key].length} services <span aria-hidden="true">·</span> Choose your boost</span>
                  </span>
                  <span className="home-game-card-arrow" aria-hidden="true"><ArrowUpRightIcon /></span>
                </span>
              </button>
            ))}
          </div>
        </section>
      </main>

      {visibleGame && !showAuthModal && (
        <GameServiceDialog
          game={gameOptions.find((game) => game.key === visibleGame)}
          open={Boolean(selectedGame)}
          services={featuredServices}
          loading={servicesLoading}
          error={servicesError}
          imageMap={serviceImageMap}
          fallbackImages={fallbackImages}
          onChoose={handleOrderNow}
          onClose={closeGameServices}
          onExited={finishGameClose}
          sourceElement={gameSourceElement}
        />
      )}

      <RegisterPage
        onSocialSuccess={finishLogin}
        showAuthModal={showAuthModal}
        closeAuthModal={closeAuthModal}
        authSuccess={authSuccess}
        authSuccessTitle={authSuccessTitle}
        authSuccessText={authSuccessText}
        authMode={authMode}
        setAuthMode={setAuthMode}
        authLoading={authLoading}
        authMessage={authMessage}
        setAuthMessage={setAuthMessage}
        loginForm={loginForm}
        handleLoginInputChange={handleLoginInputChange}
        handleLoginSubmit={handleLoginSubmit}
        loginErrors={loginErrors}
        registerForm={registerForm}
        handleRegisterInputChange={handleRegisterInputChange}
        handleRegisterSubmit={handleRegisterSubmit}
        registerErrors={registerErrors}
        forgotEmail={forgotEmail}
        setForgotEmail={setForgotEmail}
        forgotError={forgotError}
        setForgotError={setForgotError}
        handleForgotPasswordSubmit={handleForgotPasswordSubmit}
        referralInvite={referralInvite}
        referralInviteLoading={referralInviteLoading}
        referralInviteError={referralInviteError}
      />

      {suspendedModal.open && (
        <div
          className="suspended-login-backdrop"
          onClick={() => setSuspendedModal({ open: false, reason: "" })}
        >
          <div
            className="suspended-login-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="suspended-login-icon">
              <div className="suspended-lock-body">
                <span className="suspended-lock-shackle" />
                <span className="suspended-lock-dot" />
              </div>
            </div>

            <p className="section-label">Access Restricted</p>
            <h2>Account Suspended</h2>

            <p>
              {suspendedModal.reason ||
                "This account is currently suspended and cannot be used to login."}
            </p>

            <button
              type="button"
              className="primary-btn suspended-login-btn"
              onClick={() => setSuspendedModal({ open: false, reason: "" })}
            >
              I understand
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default HomePage;
