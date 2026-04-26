import { useMemo, useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import "../styles/AuthPages.css";
import "../styles/ResetPasswordPage.css";

function RegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    email: "",
    password: "",
    role: "CUSTOMER",
    username: "",
    confirmPassword: "",
  });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [nameStatus, setNameStatus] = useState({ checked: false, available: false, reason: "" });

  const handleChange = (event) => {
    setForm({ ...form, [event.target.name]: event.target.value });
  };

  // Password rules (reuse Reset Password logic)
  const checks = useMemo(() => {
    const password = form.password || "";
    return {
      length: password.length >= 8,
      upper: /[A-Z]/.test(password),
      lower: /[a-z]/.test(password),
      number: /[0-9]/.test(password),
      special: /[^A-Za-z0-9]/.test(password),
    };
  }, [form.password]);

  const score = Object.values(checks).filter(Boolean).length;
  const allValid = score === 5;
  const passwordsMatch = form.confirmPassword.length > 0 && form.password === form.confirmPassword;

  // Debounced username availability
  useEffect(() => {
    const u = (form.username || "").trim();
    setNameStatus((s) => ({ ...s, checked: false }));
    if (u.length < 3) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`http://localhost:5000/api/user/check-username?u=${encodeURIComponent(u)}`);
        const data = await res.json();
        setNameStatus({ checked: true, available: !!data.available, reason: data.reason || "" });
      } catch {
        setNameStatus({ checked: true, available: false, reason: "error" });
      }
    }, 250);
    return () => clearTimeout(t);
  }, [form.username]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      // client-side validations
      if (!form.username || !nameStatus.available) {
        setMessage("Please choose an available username (min 3 chars)");
        setLoading(false);
        return;
      }
      if (!allValid) {
        setMessage("Password does not meet all requirements");
        setLoading(false);
        return;
      }
      if (!passwordsMatch) {
        setMessage("Passwords do not match");
        setLoading(false);
        return;
      }
      const response = await fetch("http://localhost:5000/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          role: form.role,
          username: form.username,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.message || "Registration failed");
        return;
      }

      setMessage("Account created successfully");
      navigate("/login");
    } catch (error) {
      setMessage("Could not connect to backend");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <p className="section-label">Create Account</p>
        <h1>Register</h1>
        <p className="section-description">
          Create an account to browse and order services.
        </p>

        <div
          className={`username-field-wrap ${nameStatus.checked && !nameStatus.available ? "show-username-tooltip" : ""
            }`}
        >
          <input
            type="text"
            name="username"
            placeholder="Username"
            value={form.username}
            onChange={handleChange}
            required
            className={`${nameStatus.checked && nameStatus.available ? "auth-input-valid" : ""} ${nameStatus.checked && !nameStatus.available ? "auth-input-error" : ""
              }`}
            aria-invalid={nameStatus.checked && !nameStatus.available}
          />

          {nameStatus.checked && !nameStatus.available && (
            <div className="username-tooltip">
              {nameStatus.reason === "taken"
                ? "Username is already taken"
                : nameStatus.reason === "invalid"
                  ? "Username is not available"
                  : "Username is already taken"}
            </div>
          )}
        </div>

        <input
          type="email"
          name="email"
          placeholder="Email"
          value={form.email}
          onChange={handleChange}
          required
        />

        <input
          type="password"
          name="password"
          placeholder="Password"
          value={form.password}
          onChange={handleChange}
          required
          className={`${allValid ? "auth-input-valid" : ""}`}
        />

        <div className="password-strength">
          <div className={`password-strength-track ${allValid ? "is-strong" : ""}`}>
            <div className="password-strength-cover" style={{ left: `${(score / 5) * 100}%` }} />
          </div>
          <div className="password-rules">
            <p className={checks.length ? "rule-valid" : ""}>{checks.length ? "✓" : "•"} At least 8 characters</p>
            <p className={checks.upper ? "rule-valid" : ""}>{checks.upper ? "✓" : "•"} One uppercase letter</p>
            <p className={checks.lower ? "rule-valid" : ""}>{checks.lower ? "✓" : "•"} One lowercase letter</p>
            <p className={checks.number ? "rule-valid" : ""}>{checks.number ? "✓" : "•"} One number</p>
            <p className={checks.special ? "rule-valid" : ""}>{checks.special ? "✓" : "•"} One special character</p>
          </div>
        </div>

        <input
          type="password"
          name="confirmPassword"
          placeholder="Confirm password"
          value={form.confirmPassword}
          onChange={handleChange}
          required
          className={`${passwordsMatch ? "auth-input-valid" : ""}`}
        />

        <button className="primary-btn auth-submit-btn" type="submit" disabled={loading}>
          {loading ? "Creating..." : "Register"}
        </button>

        {message && <p className="info-message">{message}</p>}

        <p className="auth-switch-text">
          Already have an account? <Link to="/login">Login</Link>
        </p>
      </form>
    </div>
  );
}

export default RegisterPage;