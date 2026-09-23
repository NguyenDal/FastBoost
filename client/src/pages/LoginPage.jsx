import { storeAuthSession } from "../utils/authStorage";
import { notifyAuthChanged } from "../utils/authSession";
import SocialAuthButtons from "../components/SocialAuthButtons";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { API_BASE_URL } from "../api/config";
import "../styles/AuthPages.css";

function LoginPage() {
  const location = useLocation();
  const redirectTo = location.state?.from || "/";
  const navigate = useNavigate();
  const [form, setForm] = useState({
    email: "",
    password: "",
    rememberMe: false,
  });
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChange = (event) => {
    const { name, type, checked, value } = event.target;
    setForm({ ...form, [name]: type === "checkbox" ? checked : value });
  };

  const finishLogin = ({ token, user, rememberMe = form.rememberMe }) => {
    storeAuthSession(token, user, rememberMe);
    notifyAuthChanged({ loggedIn: true });
    navigate(redirectTo);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.message || "Login failed");
        return;
      }

      finishLogin(data);
    } catch {
      setMessage("Could not connect to backend");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>Login</h1>
        <p className="section-description">
          Sign in to continue your FastBoost experience.
        </p>

        <form onSubmit={handleSubmit}>
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
        />

        <label className="auth-check-row auth-page-remember"><input type="checkbox" name="rememberMe" checked={form.rememberMe} onChange={handleChange}/><span>Remember me</span></label>
        <button className="primary-btn auth-submit-btn" type="submit" disabled={loading}>
          {loading ? "Logging in..." : "Login"}
        </button>
        </form>

        {message && <p className="info-message" role="alert">{message}</p>}
        <SocialAuthButtons rememberMe={form.rememberMe} onSuccess={finishLogin} onError={setMessage}/>

        <p className="auth-switch-text">
          Don&apos;t have an account? <Link to="/register">Register</Link>
        </p>
      </div>
    </div>
  );
}

export default LoginPage;
