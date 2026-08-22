import { useState } from "react";
import Navbar from "../components/Navbar";
import { sendContactEmail } from "../api/contact";
import { API_BASE_URL } from "../api/config";
import RegisterPage from "./RegisterPage";
import { notifyAuthChanged } from "../utils/authSession";

export default function ContactPage() {

    const [form, setForm] = useState({
        name: "",
        email: "",
        subject: "",
        message: "",
    });

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const [showSuccessPopup, setShowSuccessPopup] = useState(false);

    const [showAuthModal, setShowAuthModal] = useState(false);
    const [authMode, setAuthMode] = useState("login");
    const [loginForm, setLoginForm] = useState({ email: "", password: "" });
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
    const [loginErrors, setLoginErrors] = useState({ email: false, password: false });
    const [registerErrors, setRegisterErrors] = useState({ email: false, password: false });

    const resetAuthState = () => {
        setShowAuthModal(false);
        setAuthMode("login");
        setAuthLoading(false);
        setAuthMessage("");
        setAuthSuccess(false);
        setAuthSuccessTitle("");
        setAuthSuccessText("");
        setForgotEmail("");
        setForgotError(false);
        setLoginErrors({ email: false, password: false });
        setRegisterErrors({ email: false, password: false });
        setLoginForm({ email: "", password: "" });
        setRegisterForm({
            email: "",
            password: "",
            role: "CUSTOMER",
            username: "",
            confirmPassword: "",
        });
    };

    const handleLoginInputChange = (event) => {
        const { name, value } = event.target;
        setLoginForm((prev) => ({ ...prev, [name]: value }));
        setLoginErrors((prev) => ({ ...prev, [name]: false }));
        setAuthMessage("");
    };

    const handleRegisterInputChange = (event) => {
        const { name, value } = event.target;
        setRegisterForm((prev) => ({ ...prev, [name]: value }));
        setRegisterErrors((prev) => ({ ...prev, [name]: false }));
        setAuthMessage("");
    };

    const finishLogin = (data) => {
        const user = {
            ...(data?.user || {}),
            email: data?.user?.email || data?.email || loginForm.email,
            role: data?.user?.role || "CUSTOMER",
        };

        localStorage.setItem("token", data?.token || "logged-in");
        localStorage.setItem("user", JSON.stringify(user));
        notifyAuthChanged({ user });
        setAuthSuccess(true);
        setAuthSuccessTitle("Login Successful");
        setAuthSuccessText("Welcome to FastBoost.");

        window.setTimeout(resetAuthState, 1200);
    };

    const handleLoginSubmit = async (event) => {
        event.preventDefault();
        setAuthLoading(true);
        setAuthMessage("");
        setAuthSuccess(false);
        setLoginErrors({ email: false, password: false });

        try {
            const response = await fetch(`${API_BASE_URL}/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(loginForm),
            });
            const data = await response.json();

            if (!response.ok) {
                setLoginErrors({ email: true, password: true });
                setAuthMessage(data.message || "Incorrect email or password");
                return;
            }

            finishLogin(data);
        } catch {
            setLoginErrors({ email: true, password: true });
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
        setRegisterErrors({ email: false, password: false });

        try {
            const { email, password, role, username } = registerForm;
            const response = await fetch(`${API_BASE_URL}/auth/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password, role, username }),
            });
            const data = await response.json();

            if (!response.ok) {
                setRegisterErrors({ email: true, password: true });
                setAuthMessage(data.message || "Registration failed");
                return;
            }

            const loginResponse = await fetch(`${API_BASE_URL}/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
            });
            const loginData = await loginResponse.json();

            if (!loginResponse.ok) {
                setAuthSuccess(true);
                setAuthSuccessTitle("Registration Successful");
                setAuthSuccessText("Your account was created. Please login.");
                window.setTimeout(() => {
                    setAuthSuccess(false);
                    setAuthMode("login");
                    setLoginForm({ email, password: "" });
                }, 1200);
                return;
            }

            finishLogin(loginData);
        } catch {
            setRegisterErrors({ email: true, password: true });
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
                headers: { "Content-Type": "application/json" },
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
            window.setTimeout(resetAuthState, 1200);
        } catch {
            setForgotError(true);
            setAuthMessage("Could not connect to backend");
        } finally {
            setAuthLoading(false);
        }
    };

    const handleChange = (event) => {
        const { name, value } = event.target;
        setForm((prev) => ({ ...prev, [name]: value }));
        setError("");
    };

    const handleSubmit = async (event) => {
        event.preventDefault();

        try {
            setLoading(true);
            setError("");

            await sendContactEmail(form);

            setShowSuccessPopup(true);

            setForm({
                name: "",
                email: "",
                subject: "",
                message: "",
            });

            setTimeout(() => {
                setShowSuccessPopup(false);
            }, 3200);
        } catch (err) {
            setError(err.message || "Failed to send message.");
        } finally {
            setLoading(false);
        }
    };



    return (
        <div className="page-shell contact-page-shell">
            <Navbar
                setAuthMode={setAuthMode}
                setAuthMessage={setAuthMessage}
                setAuthSuccess={setAuthSuccess}
                setLoginErrors={setLoginErrors}
                setRegisterErrors={setRegisterErrors}
                setForgotError={setForgotError}
                setForgotEmail={setForgotEmail}
                setShowAuthModal={setShowAuthModal}
            />

            <main className="page-container contact-page-container">
                <section className="contact-hero">
                    <h1>Contact us</h1>
                    <p>
                        Send us a message for general questions, billing help, partnership requests,
                        or support with an active order.
                    </p>
                </section>

                {error && <p className="contact-message contact-error">{error}</p>}

                <section className="contact-form-card contact-form-open">
                    <div className="contact-form-heading">
                        <p className="section-label">Email Support</p>
                        <h2>Send us a message</h2>
                    </div>

                    <form onSubmit={handleSubmit} className="contact-form">
                        <div className="contact-form-grid">
                            <label>
                                Name
                                <input
                                    name="name"
                                    value={form.name}
                                    onChange={handleChange}
                                    placeholder="Your name"
                                    required
                                    tabIndex={0}
                                />
                            </label>

                            <label>
                                Email
                                <input
                                    name="email"
                                    type="email"
                                    value={form.email}
                                    onChange={handleChange}
                                    placeholder="you@example.com"
                                    required
                                    tabIndex={0}
                                />
                            </label>
                        </div>

                        <label>
                            Subject
                            <input
                                name="subject"
                                value={form.subject}
                                onChange={handleChange}
                                placeholder="How can we help?"
                                required
                                tabIndex={0}
                            />
                        </label>

                        <label>
                            Message
                            <textarea
                                name="message"
                                value={form.message}
                                onChange={handleChange}
                                placeholder="Tell us what happened..."
                                rows={6}
                                required
                                tabIndex={0}
                            />
                        </label>

                        <button
                            type="submit"
                            className="contact-submit-btn"
                            disabled={loading}
                            tabIndex={0}
                        >
                            {loading ? "Sending..." : "Send Message"}
                        </button>
                    </form>
                </section>
            </main>

            {showSuccessPopup && (
                <div className="contact-success-popup-backdrop">
                    <div className="contact-success-popup" role="status" aria-live="polite">
                        <button
                            type="button"
                            className="contact-success-close"
                            onClick={() => setShowSuccessPopup(false)}
                            aria-label="Close success message"
                        >
                            ×
                        </button>

                        <div className="contact-success-animation">
                            <div className="contact-mail-orbit">
                                <svg viewBox="0 0 24 24" fill="none" className="contact-mail-icon">
                                    <path
                                        d="M4 6.5H20V17.5H4V6.5Z"
                                        stroke="currentColor"
                                        strokeWidth="1.8"
                                        strokeLinejoin="round"
                                    />
                                    <path
                                        d="M4.5 7L12 13L19.5 7"
                                        stroke="currentColor"
                                        strokeWidth="1.8"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                            </div>

                            <div className="contact-success-check">
                                <svg viewBox="0 0 24 24" fill="none">
                                    <path
                                        d="M5 12.5L9.3 16.8L19 7"
                                        stroke="currentColor"
                                        strokeWidth="2.4"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                            </div>
                        </div>

                        <p className="contact-success-kicker">Message sent</p>
                        <h2>We received your email</h2>
                        <p>
                            FastBoost support will reply as soon as possible.
                        </p>
                    </div>
                </div>
            )}

            <RegisterPage
                showAuthModal={showAuthModal}
                closeAuthModal={resetAuthState}
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