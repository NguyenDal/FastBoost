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
                  className={registerErrors.password ? "auth-input-error" : ""}
                  required
                />

                <button
                  type="submit"
                  className="primary-btn modal-submit-btn"
                  disabled={authLoading}
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