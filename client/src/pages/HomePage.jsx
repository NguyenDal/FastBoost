import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import RegisterPage from "./RegisterPage";
import "../styles/HomePage.css";

function HomePage() {
  const navigate = useNavigate();
  const [healthMessage, setHealthMessage] = useState("Checking backend...");
  const [healthError, setHealthError] = useState("");

  const [services, setServices] = useState([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [servicesError, setServicesError] = useState("");

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState("login");

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
  });

  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotError, setForgotError] = useState(false);

  const [authLoading, setAuthLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [authSuccess, setAuthSuccess] = useState(false);
  const [authSuccessTitle, setAuthSuccessTitle] = useState("");
  const [authSuccessText, setAuthSuccessText] = useState("");

  const [loginErrors, setLoginErrors] = useState({
    email: false,
    password: false,
  });

  const [registerErrors, setRegisterErrors] = useState({
    email: false,
    password: false,
  });

  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const savedUser = localStorage.getItem("user");
      const savedToken = localStorage.getItem("token");

      if (savedUser) {
        return JSON.parse(savedUser);
      }

      if (savedToken) {
        return { email: "Signed in user" };
      }

      return null;
    } catch (error) {
      return null;
    }
  });

  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const fallbackImages = [
    "https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1545239351-1141bd82e8a6?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=1200&q=80",
  ];

  const serviceImageMap = {
    "Rank Boost":
      "https://fastboost-assets.s3.amazonaws.com/services/rank-boost.webp",
    "Placement Boost":
      "https://fastboost-assets.s3.amazonaws.com/services/placement-boost.webp",
    "Win Boost":
      "https://fastboost-assets.s3.amazonaws.com/services/win-boost.png",
    "Pro Duo":
      "https://fastboost-assets.s3.amazonaws.com/services/hire-a-teammate.png",
  };

  const patchHighlights = [
    {
      title: "Patch Overview",
      text: "Champion balance, item tuning, and system adjustments summarized in one place.",
      tag: "Live",
    },
    {
      title: "Meta Watch",
      text: "Quick snapshot of what may become stronger or weaker after the newest patch.",
      tag: "Update",
    },
    {
      title: "Gameplay Notes",
      text: "Useful highlights for players planning ranked climbs this patch cycle.",
      tag: "Guide",
    },
  ];

  useEffect(() => {
    const fetchData = async () => {
      try {
        const healthResponse = await fetch("http://localhost:5000/api/health");

        if (!healthResponse.ok) {
          throw new Error("Health check failed");
        }

        const healthData = await healthResponse.json();
        setHealthMessage(healthData.message || "Backend is running");
      } catch (error) {
        setHealthError("Could not connect to backend");
      }

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

  const servicePriority = {
    "Rank Boost": 1,
    "Placement Boost": 2,
    "Win Boost": 3,
    "Pro Duo": 4,
  };

  const featuredServices = [...services]
    .sort((a, b) => {
      const aPriority = servicePriority[a.title] ?? 999;
      const bPriority = servicePriority[b.title] ?? 999;
      return aPriority - bPriority;
    })
    .slice(0, 4);

  const hasSession = Boolean(localStorage.getItem("token")) || Boolean(currentUser);

  const handleOrderNow = (service) => {
    navigate(`/order/${service.id}`);
  };

  const handleDetails = (service) => {
    navigate(`/services/${service.id}`);
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
    });
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setCurrentUser(null);
    setShowProfileMenu(false);
  };

  const finishLogin = ({ token, email, profileImage = "", role = "CUSTOMER" }) => {
    const loggedInUser = {
      email,
      profileImage,
      role,
    };

    localStorage.setItem("token", token || "logged-in");
    localStorage.setItem("user", JSON.stringify(loggedInUser));
    setCurrentUser(loggedInUser);

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
        setLoginErrors({
          email: true,
          password: true,
        });
        setAuthMessage(data.message || "Incorrect email or password");
        return;
      }

      finishLogin({
        token: data?.token,
        email: data?.user?.email || data?.email || loginForm.email,
        profileImage:
          data?.user?.profileImage ||
          data?.user?.avatar ||
          data?.user?.photoUrl ||
          "",
        role: data?.user?.role || "CUSTOMER",
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
      const { email, password, role, username } = registerForm;

      const registerResponse = await fetch("http://localhost:5000/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password, role, username }),
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
          });
          setAuthSuccessTitle("");
          setAuthSuccessText("");
        }, 1200);

        return;
      }

      finishLogin({
        token: loginData?.token,
        email: loginData?.user?.email || loginData?.email || registerForm.email,
        profileImage:
          loginData?.user?.profileImage ||
          loginData?.user?.avatar ||
          loginData?.user?.photoUrl ||
          "",
        role: loginData?.user?.role || "CUSTOMER",
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
      <main id="home" className="page-content">
        <section className="hero-section">
          <div className="hero-banner">
            <div className="hero-overlay" />

            <img
              className="hero-image"
              src="https://images.unsplash.com/photo-1511882150382-421056c89033?auto=format&fit=crop&w=1600&q=80"
              alt="Gaming hero banner"
            />

            <div className="hero-content">
              <p className="hero-kicker">Competitive Gaming Platform</p>
              <h1>Level up your League experience with a sleek, modern service hub.</h1>
              <p className="hero-text">
                Explore rank boosting, win boosting, placements, and duo queue
                services in a premium gaming-style homepage built for growth.
              </p>

              <div className="hero-actions">
                <a href="#services" className="primary-btn">
                  Browse Services
                </a>
                <a href="#patch" className="secondary-btn">
                  Latest LoL Patch
                </a>
              </div>
            </div>

            <div className="hero-side-card">
              <p className="side-card-tag">Now Building</p>
              <h3>Homepage + Services + Patch Hub</h3>
              <p>
                This layout is ready for real API-driven services and a future
                live League patch notes section.
              </p>
              <button className="side-card-btn">Read More</button>
            </div>
          </div>
        </section>

        <section id="services" className="content-section">
          <div className="section-header">
            <div>
              <p className="section-label">Services</p>
              <h2>Featured Gaming Services</h2>
            </div>
            <p className="section-description">
              Hover over a service to view details and start your order flow.
            </p>
          </div>

          {servicesLoading && <p className="info-message">Loading services...</p>}
          {servicesError && <p className="error-message">{servicesError}</p>}

          {!servicesLoading && !servicesError && featuredServices.length === 0 && (
            <p className="info-message">No services found.</p>
          )}

          {!servicesLoading && !servicesError && featuredServices.length > 0 && (
            <div className="hover-service-grid">
              {featuredServices.map((service, index) => {
                const serviceImage =
                  serviceImageMap[service.title] ||
                  fallbackImages[index % fallbackImages.length];

                return (
                  <article
                    key={service.id}
                    className="hover-service-card"
                    style={{
                      backgroundImage: `url(${serviceImage})`,
                    }}
                  >
                    <div className="hover-service-overlay" />

                    <div className="hover-service-default">
                      <span className="service-tag">
                        {index === 0 ? "Popular" : "Service"}
                      </span>
                      <h3>{service.title}</h3>
                    </div>

                    <div className="hover-service-content">
                      <h3>{service.title}</h3>
                      <p>{service.description || "No description available."}</p>

                      <div className="hover-service-actions">
                        <button
                          className="card-btn primary-card-btn"
                          onClick={() => handleOrderNow(service)}
                        >
                          Order Now
                        </button>
                        <button
                          className="card-btn secondary-card-btn"
                          onClick={() => handleDetails(service)}
                        >
                          Details
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section id="patch" className="content-section news-layout">
          <div className="news-left">
            <div className="section-header left-aligned">
              <div>
                <p className="section-label">Latest Patch</p>
                <h2>League Patch Center</h2>
              </div>
            </div>

            <div className="news-list">
              {patchHighlights.map((item, index) => (
                <article
                  key={item.title}
                  className={`news-item ${index === 0 ? "news-item-active" : ""}`}
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

          <div className="news-feature">
            <div className="feature-image-wrap">
              <img
                src="https://images.unsplash.com/photo-1547394765-185e1e68f34e?auto=format&fit=crop&w=1400&q=80"
                alt="Latest patch feature"
              />
              <div className="feature-overlay" />
            </div>

            <div className="feature-card">
              <span className="feature-chip">Latest Patch</span>
              <h3>Patch 25.X — balance changes and ranked impact</h3>
              <p>
                Use this space to show the newest patch summary, key champion
                adjustments, item changes, and a quick read-more action.
              </p>
              <button className="card-btn primary-card-btn">Read Patch Notes</button>
            </div>
          </div>
        </section>

        <section id="status" className="content-section">
          <div className="status-panel">
            <div className="status-dot" />
            <div>
              <p className="status-title">Backend Status</p>
              {healthError ? (
                <p className="status-error">{healthError}</p>
              ) : (
                <p className="status-text">{healthMessage}</p>
              )}
            </div>
          </div>
        </section>
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
      />
    </div>
  );
}

export default HomePage;