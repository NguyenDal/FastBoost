import { useEffect, useMemo, useState } from "react";
import "../styles/ResetPasswordPage.css";

function AuthModal({
  showAuthModal,
  closeAuthModal,
  authSuccess,
  authSuccessTitle,
  authSuccessText,
  authMode,
  setAuthMode,
  authLoading,
  authMessage,
  setAuthMessage,
  loginForm,
  handleLoginInputChange,
  handleLoginSubmit,
  loginErrors,
  registerForm,
  handleRegisterInputChange,
  handleRegisterSubmit,
  registerErrors,
  forgotEmail,
  setForgotEmail,
  forgotError,
  setForgotError,
  handleForgotPasswordSubmit,
}) {
  // Local computed state for Register mode
  const [nameStatus, setNameStatus] = useState({
    checked: false,
    available: false,
    reason: "",
  });

  const checks = useMemo(() => {
    const password = (registerForm?.password) || "";
    return {
      length: password.length >= 8,
      upper: /[A-Z]/.test(password),
      lower: /[a-z]/.test(password),
      number: /[0-9]/.test(password),
      special: /[^A-Za-z0-9]/.test(password),
    };
  }, [registerForm?.password]);

  const score = Object.values(checks).filter(Boolean).length;
  const allValid = score === 5;
  const passwordsMatch = Boolean(registerForm?.confirmPassword) && registerForm?.password === registerForm?.confirmPassword;

  // Debounced username availability check (register mode only)
  useEffect(() => {
    if (authMode !== "register") return;
    const u = (registerForm?.username || "").trim();
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
  }, [authMode, registerForm?.username]);

  if (!showAuthModal) return null;

  return (
    <div className="modal-backdrop" onClick={closeAuthModal}>
      <div className="auth-modal" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close-btn" onClick={closeAuthModal}>
          ×
        </button>

        {authSuccess ? (
          <div className="auth-success-state">
            <div className="success-checkmark-wrap">
              <div className="success-checkmark-circle">
                <span className="success-checkmark">✓</span>
              </div>
            </div>
            <h2 className="modal-title">{authSuccessTitle}</h2>
            <p className="section-description modal-description">
              {authSuccessText}
            </p>
          </div>
        ) : (
          <>
            <p className="section-label">Account Access</p>
            <h2 className="modal-title">
              {authMode === "login"
                ? "Login"
                : authMode === "forgot"
                  ? "Forgot Password"
                  : "Register"}
            </h2>

            <p className="section-description modal-description">
              {authMode === "login"
                ? "Sign in without leaving the homepage."
                : authMode === "forgot"
                  ? "Enter your registered email to receive a reset link."
                  : "Create an account without leaving the homepage."}
            </p>

            {authMode === "login" ? (
              <form className="auth-modal-form" onSubmit={handleLoginSubmit}>
                <input
                  type="email"
                  name="email"
                  placeholder="Email"
                  value={loginForm.email}
                  onChange={handleLoginInputChange}
                  className={loginErrors.email ? "auth-input-error" : ""}
                  required
                />

                <input
                  type="password"
                  name="password"
                  placeholder="Password"
                  value={loginForm.password}
                  onChange={handleLoginInputChange}
                  className={loginErrors.password ? "auth-input-error" : ""}
                  required
                />

                <button
                  type="submit"
                  className="primary-btn modal-submit-btn"
                  disabled={authLoading}
                >
                  {authLoading ? "Logging in..." : "Login"}
                </button>

                <p className="forgot-password-line">
                  <button
                    type="button"
                    className="auth-switch-btn"
                    onClick={() => {
                      setAuthMode("forgot");
                      setAuthMessage("");
                      setForgotError(false);
                    }}
                  >
                    Forgot password?
                  </button>
                </p>
              </form>
            ) : authMode === "forgot" ? (
              <form className="auth-modal-form" onSubmit={handleForgotPasswordSubmit}>
                <input
                  type="email"
                  placeholder="Enter your registered email"
                  value={forgotEmail}
                  onChange={(event) => {
                    setForgotEmail(event.target.value);
                    setForgotError(false);
                    setAuthMessage("");
                  }}
                  className={forgotError ? "auth-input-error" : ""}
                  required
                />

                <button
                  type="submit"
                  className="primary-btn modal-submit-btn"
                  disabled={authLoading}
                >
                  {authLoading ? "Sending..." : "Send Reset Link"}
                </button>
              </form>
            ) : (
              <form className="auth-modal-form" onSubmit={handleRegisterSubmit}>
                <div
                  className={`username-field-wrap ${nameStatus.checked && !nameStatus.available ? "show-username-tooltip" : ""
                    }`}
                >
                  <input
                    type="text"
                    name="username"
                    placeholder="Username"
                    value={registerForm.username || ""}
                    onChange={handleRegisterInputChange}
                    className={`${nameStatus.checked && nameStatus.available ? "auth-input-valid" : ""} ${nameStatus.checked && !nameStatus.available ? "auth-input-error" : ""
                      }`}
                    aria-invalid={nameStatus.checked && !nameStatus.available}
                    required
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
                  value={registerForm.email}
                  onChange={handleRegisterInputChange}
                  className={registerErrors.email ? "auth-input-error" : ""}
                  required
                />

                <input
                  type="password"
                  name="password"
                  placeholder="Password"
                  value={registerForm.password}
                  onChange={handleRegisterInputChange}
                  className={`${allValid ? "auth-input-valid" : ""} ${registerErrors.password ? "auth-input-error" : ""}`}
                  required
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
                  value={registerForm.confirmPassword || ""}
                  onChange={handleRegisterInputChange}
                  className={`${passwordsMatch ? "auth-input-valid" : ""}`}
                  required
                />

                <button
                  type="submit"
                  className="primary-btn modal-submit-btn"
                  disabled={authLoading || !nameStatus.available || !allValid || !passwordsMatch}
                  title={!nameStatus.available ? "Choose an available username" : (!allValid ? "Password does not meet all rules" : (!passwordsMatch ? "Passwords do not match" : undefined))}
                >
                  {authLoading ? "Creating account..." : "Register"}
                </button>
              </form>
            )}

            {authMessage && (
              <p className="info-message auth-error-message">{authMessage}</p>
            )}

            <p className="auth-switch-line">
              {authMode === "login" ? (
                <>
                  Don&apos;t have an account?{" "}
                  <button
                    type="button"
                    className="auth-switch-btn"
                    onClick={() => {
                      setAuthMode("register");
                      setAuthMessage("");
                    }}
                  >
                    Register
                  </button>
                </>
              ) : authMode === "forgot" ? (
                <>
                  Remembered your password?{" "}
                  <button
                    type="button"
                    className="auth-switch-btn"
                    onClick={() => {
                      setAuthMode("login");
                      setAuthMessage("");
                      setForgotError(false);
                    }}
                  >
                    Back to Login
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button
                    type="button"
                    className="auth-switch-btn"
                    onClick={() => {
                      setAuthMode("login");
                      setAuthMessage("");
                    }}
                  >
                    Login
                  </button>
                </>
              )}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default AuthModal;