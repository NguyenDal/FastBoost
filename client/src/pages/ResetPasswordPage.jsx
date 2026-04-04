import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import "../App.css";

function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") || "";

  const [form, setForm] = useState({
    password: "",
    confirmPassword: "",
  });

  const [errors, setErrors] = useState({
    password: "",
    confirmPassword: "",
    general: "",
  });

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const checks = useMemo(() => {
    const password = form.password;

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
  const passwordsMatch =
    form.confirmPassword.length > 0 && form.password === form.confirmPassword;

  const handleChange = (event) => {
    const { name, value } = event.target;

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));

    setErrors((prev) => ({
      ...prev,
      [name]: "",
      general: "",
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const nextErrors = {
      password: "",
      confirmPassword: "",
      general: "",
    };

    if (!token) {
      nextErrors.general = "This reset link is invalid or missing.";
    }

    if (!allValid) {
      nextErrors.password = "Password does not meet all requirements.";
    }

    if (form.password !== form.confirmPassword) {
      nextErrors.confirmPassword = "Passwords do not match.";
    }

    if (nextErrors.password || nextErrors.confirmPassword || nextErrors.general) {
      setErrors(nextErrors);
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("http://localhost:5000/api/auth/reset-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token,
          password: form.password,
          confirmPassword: form.confirmPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setErrors((prev) => ({
          ...prev,
          general: data.message || "Could not reset password",
          password: data.field === "password" ? data.message : prev.password,
          confirmPassword:
            data.field === "confirmPassword" ? data.message : prev.confirmPassword,
        }));
        return;
      }

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user || {}));
      setSuccess(true);

      setTimeout(() => {
        navigate("/");
      }, 1200);
    } catch (error) {
      setErrors((prev) => ({
        ...prev,
        general: "Could not connect to backend",
      }));
    } finally {
      setLoading(false);
    }
  };

  const barPercent = `${(score / 5) * 100}%`;

  return (
    <div className="reset-page">
      <div className="reset-card">
        {success ? (
          <div className="auth-success-state">
            <div className="success-checkmark-wrap">
              <div className="success-checkmark-circle">
                <span className="success-checkmark">✓</span>
              </div>
            </div>
            <h2 className="modal-title">Password Updated</h2>
            <p className="section-description modal-description">
              You are now logged in.
            </p>
          </div>
        ) : (
          <>
            <p className="section-label">Password Reset</p>
            <h1 className="modal-title">Set a new password</h1>
            <p className="section-description modal-description">
              Choose a strong password for your account.
            </p>

            <form className="auth-modal-form" onSubmit={handleSubmit}>
              <input
                type="password"
                name="password"
                placeholder="New password"
                value={form.password}
                onChange={handleChange}
                className={`${allValid ? "auth-input-valid" : ""} ${
                  errors.password ? "auth-input-error" : ""
                }`}
                required
              />

              <div className="password-strength">
                <div className="password-strength-track">
                  <div
                    className={`password-strength-fill ${allValid ? "is-strong" : ""}`}
                    style={{ width: barPercent }}
                  />
                </div>

                <div className="password-rules">
                  <p className={checks.length ? "rule-valid" : ""}>
                    {checks.length ? "✓" : "•"} At least 8 characters
                  </p>
                  <p className={checks.upper ? "rule-valid" : ""}>
                    {checks.upper ? "✓" : "•"} One uppercase letter
                  </p>
                  <p className={checks.lower ? "rule-valid" : ""}>
                    {checks.lower ? "✓" : "•"} One lowercase letter
                  </p>
                  <p className={checks.number ? "rule-valid" : ""}>
                    {checks.number ? "✓" : "•"} One number
                  </p>
                  <p className={checks.special ? "rule-valid" : ""}>
                    {checks.special ? "✓" : "•"} One special character
                  </p>
                </div>
              </div>

              <input
                type="password"
                name="confirmPassword"
                placeholder="Confirm new password"
                value={form.confirmPassword}
                onChange={handleChange}
                className={`${passwordsMatch ? "auth-input-valid" : ""} ${
                  errors.confirmPassword ? "auth-input-error" : ""
                }`}
                required
              />

              {errors.confirmPassword && (
                <p className="info-message auth-error-message">{errors.confirmPassword}</p>
              )}

              {errors.password && (
                <p className="info-message auth-error-message">{errors.password}</p>
              )}

              {errors.general && (
                <p className="info-message auth-error-message">{errors.general}</p>
              )}

              <button
                type="submit"
                className="primary-btn modal-submit-btn"
                disabled={loading}
              >
                {loading ? "Updating..." : "Reset Password"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default ResetPasswordPage;