import {
  getStoredUser,
  hasValidSession,
  notifyAuthChanged,
} from "../utils/authSession";

import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import RegisterPage from "./RegisterPage";
import CleanIcon from "../components/CleanIcon";
import { CardGridSkeleton } from "../components/PageSkeletons";
import { API_BASE_URL } from "../api/config";
import "../styles/HomePage.css";

function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { referralCode } = useParams();

  const [services, setServices] = useState([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [servicesError, setServicesError] = useState("");
  const [selectedGame, setSelectedGame] = useState("");
  const [visibleGame, setVisibleGame] = useState("");
  const [selectedUpdateType, setSelectedUpdateType] = useState("event");

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState("login");

  const [referralInvite, setReferralInvite] = useState(null);
  const [referralInviteLoading, setReferralInviteLoading] = useState(false);
  const [referralInviteError, setReferralInviteError] = useState("");

  const [loginForm, setLoginForm] = useState({
    email: "",
    password: "",
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

  const newsFeatureRef = useRef(null);

  const [activeNewsModal, setActiveNewsModal] = useState(null);
  const [newsModalOrigin, setNewsModalOrigin] = useState(null);
  const [newsModalClosing, setNewsModalClosing] = useState(false);
  const [selectedLaunchGame, setSelectedLaunchGame] = useState("lol");

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
        "https://fastboost-assets.s3.amazonaws.com/services/lol-card.jpg",
      status: "Available",
    },
    {
      key: "tft",
      title: "Teamfight Tactics",
      shortTitle: "TFT",
      description: "Rank boost, win boost, and placement services for TFT.",
      image:
        "https://fastboost-assets.s3.amazonaws.com/services/tft-card.jpg",
      status: "Available",
    },
  ];

  const serviceImageMap = {
    "Rank Boost":
      "https://fastboost-assets.s3.amazonaws.com/services/rank-boost-transparent.png",
    "Placement Boost":
      "https://fastboost-assets.s3.amazonaws.com/services/placement-boost-transparent.png",
    "Win Boost":
      "https://fastboost-assets.s3.amazonaws.com/services/win-boost-transparent.png",
    "Pro Duo":
      "https://fastboost-assets.s3.amazonaws.com/services/pro-duo-transparent.png",
    "TFT Rank Boost":
      "https://fastboost-assets.s3.amazonaws.com/services/rank-boost-transparent.png",
    "TFT Win Boost":
      "https://fastboost-assets.s3.amazonaws.com/services/win-boost-transparent.png",
    "TFT Placement Boost":
      "https://fastboost-assets.s3.amazonaws.com/services/placement-boost-transparent.png",
  };

  const fastBoostEventImage =
    "https://images.unsplash.com/photo-1547394765-185e1e68f34e?auto=format&fit=crop&w=1400&q=80";

  const homepageUpdates = [
    {
      title: "Latest Event",
      text: "FastBoost opening day is here. League of Legends and TFT services are now open.",
      tag: "Event",
      type: "event",
      featureTag: "Opening Event",
      featureTitle: "FastBoost Opening Event",
      featureText:
        "FastBoost is now opening with League of Legends and Teamfight Tactics services available for customers.",
      buttonText: "Show Event",
      image: fastBoostEventImage,
      fullTitle: "FastBoost Opening Day",
      fullSubtitle:
        "League of Legends and Teamfight Tactics services are now open on FastBoost.",
      fullDescription:
        "FastBoost is officially opening as a gaming services platform built around a clean order flow, secure checkout, protected order chat, and role-based support for customers, boosters, and admins.",
      launchGames: {
        lol: {
          shortName: "LoL",
          title: "League of Legends",
          status: "Now Open",
          description:
            "League of Legends services are available on FastBoost from opening day. Customers can choose their service, configure the order, complete checkout, and continue into the protected MatchPage flow.",
          services: ["Rank Boost", "Placement Boost", "Win Boost", "Pro Duo"],
          highlights: [
            "Built for ranked climb services",
            "Supports different order types",
            "Protected order communication",
            "Secure checkout before match flow",
          ],
        },
        tft: {
          shortName: "TFT",
          title: "Teamfight Tactics",
          status: "Now Open",
          description:
            "Teamfight Tactics services are also opening on FastBoost. TFT support gives customers a separate game option while keeping the same clean order and communication experience.",
          services: ["TFT Rank Boost", "TFT Win Boost", "TFT Placement Boost"],
          highlights: [
            "Separate TFT service selection",
            "Rank, win, and placement support",
            "Same FastBoost order experience",
            "More TFT improvements planned",
          ],
        },
      },
      details: [
        "League of Legends services are open.",
        "Teamfight Tactics services are open.",
        "Customers can browse services and create orders through the homepage.",
        "Paid orders continue into a protected MatchPage chat flow.",
      ],
    },
    {
      title: "Latest Updates",
      text: "View recent service changes, new game support, and platform improvements.",
      tag: "Update",
      type: "updates",
      featureTag: "Platform Updates",
      featureTitle: "Service updates and new features",
      featureText:
        "Follow the newest FastBoost changes, including new service modes, game support, order improvements, and customer account features.",
      buttonText: "Show Updates",
      image: fastBoostEventImage,
    },
    {
      title: "FAQ / Help",
      text: "Learn how orders work, what details are needed, and how to get support.",
      tag: "Help",
      type: "faq",
      featureTag: "Help Center",
      featureTitle: "Need help before ordering?",
      featureText:
        "Find answers about order steps, account safety, required information, payment flow, service progress, and how to contact support.",
      buttonText: "Show FAQ",
      image: fastBoostEventImage,
    },
  ];

  useEffect(() => {
    if (!location.state?.openAuthModal) return;

    setAuthMode(location.state.authMode || "login");
    setShowAuthModal(true);
    setAuthMessage(
      location.state.reason === "session-expired"
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

    navigate(location.pathname, {
      replace: true,
      state: null,
    });
  }, [location.state, location.pathname, navigate]);

  useEffect(() => {
    if (!referralCode) return;

    let cancelled = false;

    const loadReferralInvite = async () => {
      setReferralInviteLoading(true);
      setReferralInviteError("");

      setRegisterForm((prev) => ({
        ...prev,
        referralCode,
      }));

      setAuthMode("register");
      setShowAuthModal(true);
      setAuthMessage("");

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
        }
      } catch (error) {
        if (!cancelled) {
          setReferralInvite(null);
          setReferralInviteError(error.message || "Could not load private invite.");
        }
      } finally {
        if (!cancelled) {
          setReferralInviteLoading(false);
        }
      }
    };

    loadReferralInvite();

    return () => {
      cancelled = true;
    };
  }, [referralCode]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const servicesResponse = await fetch("http://localhost:5000/api/services");

        if (!servicesResponse.ok) {
          throw new Error("Failed to fetch services");
        }

        const servicesData = await servicesResponse.json();
        const normalizedServices = Array.isArray(servicesData)
          ? servicesData
          : servicesData.services || [];

        setServices(normalizedServices);
      } catch (error) {
        setServicesError("Could not load services");
      } finally {
        setServicesLoading(false);
      }
    };

    fetchData();
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

  useEffect(() => {
    if (selectedGame) {
      setVisibleGame(selectedGame);
      return;
    }

    const closeTimer = setTimeout(() => {
      setVisibleGame("");
    }, 430);

    return () => clearTimeout(closeTimer);
  }, [selectedGame]);

  useEffect(() => {
    if (!activeNewsModal) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [activeNewsModal]);

  const selectedHomepageUpdate =
    homepageUpdates.find((item) => item.type === selectedUpdateType) ||
    homepageUpdates[0];

  const lolServiceTitles = ["Rank Boost", "Placement Boost", "Win Boost", "Pro Duo"];

  const tftServiceTitles = [
    "TFT Rank Boost",
    "TFT Win Boost",
    "TFT Placement Boost",
  ];

  const servicePriority = {
    "Rank Boost": 1,
    "Placement Boost": 2,
    "Win Boost": 3,
    "Pro Duo": 4,

    "TFT Rank Boost": 1,
    "TFT Win Boost": 2,
    "TFT Placement Boost": 3,
  };

  const selectedServiceTitles =
    visibleGame === "tft" ? tftServiceTitles : lolServiceTitles;

  const featuredServices = [...services]
    .filter((service) => selectedServiceTitles.includes(service.title))
    .sort((a, b) => {
      const aPriority = servicePriority[a.title] ?? 999;
      const bPriority = servicePriority[b.title] ?? 999;
      return aPriority - bPriority;
    });

  const handleOrderNow = (service) => {
    navigate(`/order/${service.id}`);
  };

  const handleHomepageUpdateClick = (type) => {
    setSelectedUpdateType(type);
  };

  const handleHomepageUpdateButtonClick = (type) => {
    const update = homepageUpdates.find((item) => item.type === type);

    if (!update) return;

    if (type !== "event") {
      setSelectedUpdateType(type);
      return;
    }

    const rect = newsFeatureRef.current?.getBoundingClientRect();

    setNewsModalOrigin(
      rect
        ? {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        }
        : null
    );

    setSelectedLaunchGame("lol");
    setNewsModalClosing(false);
    setActiveNewsModal(update);
  };

  const closeNewsModal = () => {
    if (newsModalClosing) return;

    setNewsModalClosing(true);

    setTimeout(() => {
      setActiveNewsModal(null);
      setNewsModalClosing(false);
    }, 480);
  };

  const handleLoginInputChange = (event) => {
    const { name, value } = event.target;

    setLoginForm({
      ...loginForm,
      [name]: value,
    });

    setLoginErrors((prev) => ({
      ...prev,
      [name]: false,
    }));

    setAuthMessage("");
  };

  const handleRegisterInputChange = (event) => {
    const { name, value } = event.target;

    setRegisterForm({
      ...registerForm,
      [name]: value,
    });

    setRegisterErrors((prev) => ({
      ...prev,
      [name]: false,
    }));

    setAuthMessage("");
  };

  const closeAuthModal = () => {
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
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setCurrentUser(null);
    setShowProfileMenu(false);
  };

  const finishLogin = ({ token, user }) => {
    const loggedInUser = {
      ...user,
      profileImage:
        user?.profile?.profileImageUrl ||
        user?.profileImage ||
        user?.avatar ||
        user?.photoUrl ||
        "",
    };

    localStorage.setItem("token", token || "logged-in");
    sessionStorage.removeItem("fastboost:session-expired-shown");
    localStorage.setItem("user", JSON.stringify(loggedInUser));

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
      closeAuthModal();
    }, 1200);
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
      const response = await fetch("http://localhost:5000/api/auth/login", {
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
    } catch (error) {
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

      const registerResponse = await fetch("http://localhost:5000/api/auth/register", {
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

      const loginResponse = await fetch("http://localhost:5000/api/auth/login", {
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
        }, 1200);

        return;
      }

      finishLogin({
        token: loginData?.token,
        user: {
          ...(loginData?.user || {}),
          email: loginData?.user?.email || loginData?.email || registerForm.email,
          role: loginData?.user?.role || "CUSTOMER",
        },
      });
    } catch (error) {
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
      const response = await fetch("http://localhost:5000/api/auth/forgot-password", {
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
    } catch (error) {
      setForgotError(true);
      setAuthMessage("Could not connect to backend");
    } finally {
      setAuthLoading(false);
    }
  };

  const hasSession = Boolean(localStorage.getItem("token")) || Boolean(currentUser);

  const profileImage =
    currentUser?.profileImage ||
    currentUser?.avatar ||
    currentUser?.photoUrl ||
    "";

  return (
    <div className="app-shell">
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
        <section className="hero-section hero-fullscreen-section">
          <div className="hero-banner">

            <div className="hero-game-picker">
              <div className="hero-game-heading">
                <h1>Choose Your Game, Start Your Boost</h1>
                <p>
                  FastBoost helps players order game services with a clean, simple, and secure flow.
                </p>
              </div>

              <div className="hero-game-grid">
                {gameOptions.map((game) => (
                  <article
                    key={game.key}
                    className={`hero-game-card ${selectedGame === game.key ? "hero-game-card-active" : ""}`}
                    onClick={() => {
                      setSelectedGame((prevGame) => (prevGame === game.key ? "" : game.key));
                    }}
                  >
                    <img src={game.image} alt={game.title} />

                    <div className="hero-game-card-bottom">
                      <h3>{game.shortTitle}</h3>

                      <button
                        type="button"
                        className="hero-game-select-btn"
                        disabled={false}
                      >
                        <span className="hero-game-btn-content">
                          <span
                            className={`hero-game-btn-arrow ${selectedGame === game.key ? "hero-game-btn-arrow-open" : ""
                              }`}
                          />
                          <span>
                            {selectedGame === game.key ? "Hide Services" : "Select Game"}
                          </span>
                        </span>
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section
          id="services"
          className={`services-dropdown-section ${selectedGame ? "services-dropdown-section-open" : ""}`}
        >
          <div className="services-dropdown-inner page-content">
            <div className="section-header services-mode-header">
              <div>
                <p className="section-label">
                  {visibleGame === "tft" ? "Teamfight Tactics" : "League of Legends"}
                </p>

                <h2>
                  {visibleGame === "tft" ? "Choose Your TFT Service" : "Choose Your LoL Service"}
                </h2>
              </div>
              <p className="section-description">
                {visibleGame === "tft"
                  ? "These are the current TFT order modes available on FastBoost."
                  : "These are the current LoL order modes available on FastBoost."}
              </p>
            </div>

            {servicesLoading && <CardGridSkeleton count={3} />}
            {servicesError && <p className="error-message">{servicesError}</p>}

            {!servicesLoading && !servicesError && featuredServices.length === 0 && (
              <p className="info-message">
                {visibleGame === "tft" ? "No TFT services found." : "No LoL services found."}
              </p>
            )}

            {!servicesLoading && !servicesError && featuredServices.length > 0 && (
              <div className="hover-service-grid">
                {featuredServices.map((service, index) => {
                  const serviceImage =
                    serviceImageMap[service.title] ||
                    fallbackImages[index % fallbackImages.length];

                  return (
                    <article key={service.id} className="hover-service-card">
                      {index === 0 && <span className="service-new-badge">Popular</span>}
                      {service.title === "Pro Duo" && <span className="service-new-badge">New!</span>}

                      <div className="service-card-icon">
                        <CleanIcon src={serviceImage} alt={`${service.title} icon`} />
                      </div>

                      <h3>{service.title}</h3>

                      <p>{service.description || "No description available."}</p>

                      <div className="hover-service-actions">
                        <button
                          className="card-btn primary-card-btn"
                          onClick={() => handleOrderNow(service)}
                        >
                          Buy Now
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section id="updates" className="content-section news-layout page-content">
          <div className="news-left">
            <div className="section-header left-aligned">
              <div>
                <p className="section-label">Latest News</p>
                <h2>FastBoost Updates</h2>
              </div>
            </div>

            <div className="news-list">
              {homepageUpdates.map((item, index) => (
                <article
                  key={item.title}
                  className={`news-item ${selectedUpdateType === item.type ? "news-item-active" : ""
                    }`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleHomepageUpdateClick(item.type)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      handleHomepageUpdateClick(item.type);
                    }
                  }}
                >
                  <div className="news-thumb" />
                  <div className="news-content">
                    <span className="news-badge">{item.tag}</span>
                    <h3>{item.title}</h3>
                    <p>{item.text}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="news-feature" ref={newsFeatureRef}>
            <div className="feature-image-wrap">
              <img
                src={selectedHomepageUpdate.image || fastBoostEventImage}
                alt={selectedHomepageUpdate.featureTitle}
              />
              <div className="feature-overlay" />
            </div>

            <div className="feature-card">
              <span className="feature-chip">{selectedHomepageUpdate.featureTag}</span>
              <h3>{selectedHomepageUpdate.featureTitle}</h3>
              <p>{selectedHomepageUpdate.featureText}</p>

              <button
                className="card-btn primary-card-btn feature-action-btn"
                onClick={() => handleHomepageUpdateButtonClick(selectedHomepageUpdate.type)}
              >
                {selectedHomepageUpdate.buttonText}
              </button>
            </div>
          </div>
        </section>
        {activeNewsModal && (
          <div
            className={`news-event-modal-backdrop ${newsModalClosing ? "news-event-modal-backdrop-closing" : ""}`}
            onClick={closeNewsModal}
          >
            <article
              className={`news-event-modal ${newsModalClosing ? "news-event-modal-closing" : ""}`}
              style={{
                "--news-origin-top": `${newsModalOrigin?.top ?? 120}px`,
                "--news-origin-left": `${newsModalOrigin?.left ?? 120}px`,
                "--news-origin-width": `${newsModalOrigin?.width ?? 420}px`,
                "--news-origin-height": `${newsModalOrigin?.height ?? 420}px`,
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className="news-event-close"
                onClick={closeNewsModal}
                aria-label="Close event"
              >
                ×
              </button>

              <div className="news-event-hero">
                <img
                  src={activeNewsModal.image || fastBoostEventImage}
                  alt={activeNewsModal.fullTitle || activeNewsModal.featureTitle}
                />
                <div className="news-event-hero-overlay" />

                <div className="news-event-hero-content">
                  <span className="feature-chip">{activeNewsModal.featureTag}</span>
                  <h2>{activeNewsModal.fullTitle || activeNewsModal.featureTitle}</h2>
                  <p>{activeNewsModal.fullSubtitle || activeNewsModal.featureText}</p>
                </div>
              </div>

              <div className="news-event-body">
                <div className="opening-event-intro">
                  <p>{activeNewsModal.fullDescription || activeNewsModal.featureText}</p>
                </div>

                {activeNewsModal.launchGames && (
                  <div className="opening-game-section">
                    <div className="opening-game-tabs">
                      {Object.entries(activeNewsModal.launchGames).map(([gameKey, game]) => (
                        <button
                          key={gameKey}
                          type="button"
                          className={`opening-game-tab ${selectedLaunchGame === gameKey ? "opening-game-tab-active" : ""
                            }`}
                          onClick={() => setSelectedLaunchGame(gameKey)}
                        >
                          <span>{game.shortName}</span>
                          <strong>{game.title}</strong>
                          <small>{game.status}</small>
                        </button>
                      ))}
                    </div>

                    <div className="opening-game-panel">
                      <div className="opening-game-panel-main">
                        <span className="opening-status-pill">
                          {activeNewsModal.launchGames[selectedLaunchGame].status}
                        </span>

                        <h3>{activeNewsModal.launchGames[selectedLaunchGame].title}</h3>

                        <p>{activeNewsModal.launchGames[selectedLaunchGame].description}</p>
                      </div>

                      <div className="opening-services-box">
                        <span className="opening-box-label">Available Services</span>

                        <div className="opening-service-list">
                          {activeNewsModal.launchGames[selectedLaunchGame].services.map((service) => (
                            <span key={service}>{service}</span>
                          ))}
                        </div>
                      </div>

                      <div className="opening-highlight-grid">
                        {activeNewsModal.launchGames[selectedLaunchGame].highlights.map((highlight) => (
                          <div key={highlight} className="opening-highlight-card">
                            <span>✦</span>
                            <p>{highlight}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="opening-event-timeline">
                  <div>
                    <span>01</span>
                    <h4>Choose Game</h4>
                    <p>Select League of Legends or Teamfight Tactics from the homepage.</p>
                  </div>

                  <div>
                    <span>02</span>
                    <h4>Pick Service</h4>
                    <p>Choose the boost or placement service that matches the customer’s goal.</p>
                  </div>

                  <div>
                    <span>03</span>
                    <h4>Secure Checkout</h4>
                    <p>Complete the order through the protected payment flow.</p>
                  </div>

                  <div>
                    <span>04</span>
                    <h4>MatchPage Chat</h4>
                    <p>Continue with order communication, files, and progress updates.</p>
                  </div>
                </div>

                {Array.isArray(activeNewsModal.details) && (
                  <div className="news-event-detail-grid opening-final-grid">
                    {activeNewsModal.details.map((detail) => (
                      <div key={detail} className="news-event-detail-card">
                        <span>✦</span>
                        <p>{detail}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </article>
          </div>
        )}
      </main>

      <RegisterPage
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