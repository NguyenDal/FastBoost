import { useState } from "react";
import Navbar from "../components/Navbar";
import { sendContactEmail } from "../api/contact";

export default function ContactPage() {

    const [selectedMode, setSelectedMode] = useState(null); // "email" | "chat" | null
    const [form, setForm] = useState({
        name: "",
        email: "",
        subject: "",
        message: "",
    });

    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState("");
    const [error, setError] = useState("");

    const [showSuccessPopup, setShowSuccessPopup] = useState(false);

    const handleChange = (event) => {
        const { name, value } = event.target;
        setForm((prev) => ({ ...prev, [name]: value }));
        setError("");
        setSuccess("");
    };

    const handleSubmit = async (event) => {
        event.preventDefault();

        try {
            setLoading(true);
            setError("");
            setSuccess("");

            await sendContactEmail(form);

            setSuccess("");
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

    const handleOpenChat = () => {
        setSelectedMode("chat");
        setSuccess("");
        setError("Live support chat is coming soon. For now, please send us an email.");
    };

    return (
        <div className="page-shell contact-page-shell">
            <Navbar />

            <main className="page-container contact-page-container">
                <section className="contact-hero">
                    <p className="section-label">FastBoost Support</p>
                    <h1>How would you like to contact us?</h1>
                    <p>
                        Choose email for general questions, billing help, or partnership requests.
                        Choose chat when your question is related to an active order.
                    </p>
                </section>

                <section className="contact-choice-grid">
                    <button
                        type="button"
                        className={`contact-choice-card ${selectedMode === "email" ? "contact-choice-active" : ""}`}
                        onClick={() => {
                            setSelectedMode("email");
                            setError("");
                            setSuccess("");
                        }}
                    >
                        <span className="contact-choice-icon">✉</span>
                        <h2>Send Email</h2>
                        <p>Send a message directly to FastBoost support from the website.</p>
                        <span className="contact-choice-action">Write message</span>
                    </button>

                    <button
                        type="button"
                        className={`contact-choice-card ${selectedMode === "chat" ? "contact-choice-active" : ""}`}
                        onClick={() => {
                            setSelectedMode("chat");
                            handleOpenChat();
                        }}
                    >
                        <span className="contact-choice-icon">💬</span>
                        <h2>Open Chat</h2>
                        <p>Open your order chat if you need help with an active boost.</p>
                        <span className="contact-choice-action">Open chat</span>
                    </button>
                </section>

                {error && <p className="contact-message contact-error">{error}</p>}

                <section
                    className={`contact-form-card ${selectedMode === "email" ? "contact-form-open" : "contact-form-closed"
                        }`}
                >
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
                                    required={selectedMode === "email"}
                                    tabIndex={selectedMode === "email" ? 0 : -1}
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
                                    required={selectedMode === "email"}
                                    tabIndex={selectedMode === "email" ? 0 : -1}
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
                                required={selectedMode === "email"}
                                tabIndex={selectedMode === "email" ? 0 : -1}
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
                                required={selectedMode === "email"}
                                tabIndex={selectedMode === "email" ? 0 : -1}
                            />
                        </label>

                        <button
                            type="submit"
                            className="contact-submit-btn"
                            disabled={loading}
                            tabIndex={selectedMode === "email" ? 0 : -1}
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
        </div>
    );
}