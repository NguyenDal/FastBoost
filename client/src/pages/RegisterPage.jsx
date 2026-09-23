import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import SocialAuthButtons from "../components/SocialAuthButtons";
import { API_BASE_URL } from "../api/config";
import "../styles/ResetPasswordPage.css";

function RegisterPage({
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
  referralInvite,
  referralInviteLoading,
  referralInviteError,
  onSocialSuccess,
}) {
  const contentRef = useRef(null);
  const termsRef = useRef(null);
  const [termsAttempted, setTermsAttempted] = useState(false);
  const termsInvalid = termsAttempted && !registerForm?.termsAccepted;
  const highlightTerms = () => {
    setTermsAttempted(true);
    setAuthMessage("");
    termsRef.current?.focus();
  };
  useEffect(() => {
    if (!showAuthModal) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [showAuthModal]);
  const [contentHeight, setContentHeight] = useState(null);
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => setContentHeight(content.getBoundingClientRect().height));
    observer.observe(content);
    return () => observer.disconnect();
  }, [showAuthModal]);
  // Local computed state for Register mode
  const [nameResult, setNameResult] = useState({
    username: "",
    checked: false,
    available: false,
    reason: "",
  });
  const nameStatus = nameResult.username === (registerForm?.username || "").trim()
    ? nameResult : { checked: false, available: false, reason: "" };

  const [submitAttempted, setSubmitAttempted] = useState(false);

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

  const passwordsDoNotMatch =
    submitAttempted &&
    (!registerForm?.confirmPassword ||
      registerForm?.password !== registerForm?.confirmPassword);

  // Debounced username availability check (register mode only)
  useEffect(() => {
    if (authMode !== "register") return;
    const u = (registerForm?.username || "").trim();
    if (u.length < 3) return;
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/user/check-username?u=${encodeURIComponent(u)}`, { signal: controller.signal });
        const data = await res.json();
        if (!controller.signal.aborted) setNameResult({ username: u, checked: true, available: !!data.available, reason: data.reason || "" });
      } catch {
        if (!controller.signal.aborted) setNameResult({ username: u, checked: true, available: false, reason: "error" });
      }
    }, 250);
    return () => { clearTimeout(t); controller.abort(); };
  }, [authMode, registerForm?.username]);

  const handleValidatedRegisterSubmit = (event) => {
    event.preventDefault();
    setSubmitAttempted(true);
    setAuthMessage("");

    if (registerForm.termsAccepted !== true) {
      highlightTerms();
      return;
    }

    const username = (registerForm?.username || "").trim();

    if (!username || username.length < 3 || !nameStatus.available) {
      setAuthMessage("Please choose an available username.");
      return;
    }

    if (!allValid) {
      setAuthMessage("Password does not meet all requirements.");
      return;
    }

    if (!passwordsMatch) {
      setAuthMessage("Passwords do not match.");
      return;
    }

    handleRegisterSubmit(event);
  };

  if (!showAuthModal) return null;

  return (
    <div className="modal-backdrop auth-modal-backdrop" onClick={closeAuthModal}>
      <div
        className={`auth-modal auth-modal-${authMode} ${authMode === "register" && registerForm?.referralCode
          ? "auth-modal-private-invite"
          : ""
          }`}
        onClick={(event) => event.stopPropagation()}
        role="dialog" aria-modal="true" aria-label={authMode === "register" ? "Create account" : "Sign in"}
        style={{ height: contentHeight ? contentHeight + 58 : undefined }}
      >
        <button className="modal-close-btn" aria-label="Close" onClick={closeAuthModal}>
          ×
        </button>

        <div ref={contentRef} className="auth-modal-content">
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

                <label className="auth-check-row auth-remember"><input type="checkbox" name="rememberMe" checked={Boolean(loginForm.rememberMe)} onChange={handleLoginInputChange}/><span>Remember me</span></label>
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
              <form className="auth-modal-form" onSubmit={handleValidatedRegisterSubmit}>
                {registerForm?.referralCode && (
                  <div className="private-invite-register-card">
                    <div className="private-invite-card-top">
                      <div className="private-invite-avatar">
                        {referralInvite?.inviter?.profileImageUrl ? (
                          <img
                            src={referralInvite.inviter.profileImageUrl}
                            alt="Inviter profile"
                          />
                        ) : (
                          <span>
                            {(referralInvite?.inviter?.username || "F")
                              .slice(0, 1)
                              .toUpperCase()}
                          </span>
                        )}
                      </div>

                      <div>
                        <p className="private-invite-label">You are invited by</p>

                        <h3>
                          {referralInviteLoading
                            ? "Loading inviter..."
                            : referralInvite?.inviter?.username
                              ? referralInvite.inviter.username
                              : "FastBoost Invite"}
                        </h3>

                        {referralInviteError ? (
                          <p className="private-invite-error">{referralInviteError}</p>
                        ) : (
                          <p>
                            Register with this private link to receive 10% off your first purchase.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="private-invite-reward-box">
                      <div>
                        <strong>Refer a Friend</strong>
                        <span>Complete a first purchase of $50 or more and both accounts receive 50 gold = $5.</span>
                      </div>

                      <div className="private-invite-gold-pill">50 gold next</div>
                    </div>

                    <div className="private-invite-condition-list">
                      <div className="private-invite-condition">
                        <span className="condition-dot success">✓</span>
                        <p>Register using this private invite link.</p>
                      </div>

                      <div className="private-invite-condition">
                        <span className="condition-dot success">✓</span>
                        <p>Receive 10% off your first purchase.</p>
                      </div>

                      <div className="private-invite-condition">
                        <span className="condition-dot success">✓</span>
                        <p>
                          After a paid and completed $50+ first order, you and your referrer each receive 50 gold ($5). Your gold is for a future purchase.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                <div
                  className={`username-field-wrap ${submitAttempted && nameStatus.checked && !nameStatus.available
                    ? "show-username-tooltip"
                    : ""
                    }`}
                >
                  <input
                    type="text"
                    name="username"
                    placeholder="Username"
                    value={registerForm.username || ""}
                    onChange={handleRegisterInputChange}
                    className={`${nameStatus.checked && nameStatus.available ? "auth-input-valid" : ""} ${submitAttempted && nameStatus.checked && !nameStatus.available
                      ? "auth-input-error"
                      : ""
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

                <div className={`password-match-wrap ${passwordsDoNotMatch ? "show-password-tooltip" : ""}`}>
                  <input
                    type="password"
                    name="confirmPassword"
                    placeholder="Confirm password"
                    value={registerForm.confirmPassword || ""}
                    onChange={handleRegisterInputChange}
                    className={`${passwordsMatch ? "auth-input-valid" : ""} ${passwordsDoNotMatch ? "auth-input-error" : ""
                      }`}
                    aria-invalid={passwordsDoNotMatch}
                    required
                  />

                  {passwordsDoNotMatch && (
                    <div className="password-match-tooltip">
                      Passwords do not match
                    </div>
                  )}
                </div>

                <div className="auth-consents">
                  <label className={`auth-check-row auth-terms-row${termsInvalid ? " auth-check-error" : ""}`}>
                    <input ref={termsRef} type="checkbox" name="termsAccepted" checked={Boolean(registerForm.termsAccepted)}
                      onChange={(event) => { setTermsAttempted(false); handleRegisterInputChange(event); }}
                      onInvalid={(event) => { event.preventDefault(); highlightTerms(); }} aria-invalid={termsInvalid} required/>
                    <span>I agree to the <a href="/terms-and-conditions" target="_blank" rel="noreferrer">Terms and Conditions</a>. <span className="auth-required" aria-hidden="true">*</span></span>
                  </label>
                  <label className="auth-check-row"><input type="checkbox" name="promotionalEmails" checked={Boolean(registerForm.promotionalEmails)} onChange={handleRegisterInputChange}/><span>I agree to receive promotional emails.</span></label>
                </div>
                <button
                  type="submit"
                  className="primary-btn modal-submit-btn"
                  disabled={authLoading}
                  onClick={(event) => {
                    if (!registerForm.termsAccepted) { event.preventDefault(); highlightTerms(); }
                    else setSubmitAttempted(true);
                  }}
                >
                  {authLoading ? "Creating account..." : "Register"}
                </button>
              </form>
            )}

            {authMessage && <p className="auth-error-message" role="alert">{authMessage}</p>}
            {authMode !== "forgot" && <SocialAuthButtons mode={authMode} termsAccepted={registerForm?.termsAccepted} onTermsRequired={highlightTerms} promotionalEmails={registerForm?.promotionalEmails} referralCode={registerForm?.referralCode} rememberMe={authMode === "login" && Boolean(loginForm?.rememberMe)} onSuccess={onSocialSuccess} onError={setAuthMessage} />}
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
    </div>
  );
}

export default RegisterPage;
