import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { changeMyPassword } from "../api/accountSettings";
import { hasValidSession } from "../utils/authSession";
import "../styles/AccountSettings.css";

function useAccountGuard() {
    const navigate = useNavigate();
    const [hasAccess, setHasAccess] = useState(false);

    useEffect(() => {
        const check = () => {
            const token = localStorage.getItem("token");
            const userRaw = localStorage.getItem("user");

            if (!token || !userRaw || !hasValidSession()) {
                navigate("/", { replace: true });
                return;
            }

            setHasAccess(true);
        };

        check();

        window.addEventListener("focus", check);
        window.addEventListener("auth:changed", check);

        return () => {
            window.removeEventListener("focus", check);
            window.removeEventListener("auth:changed", check);
        };
    }, [navigate]);

    return hasAccess;
}

export default function ChangePasswordPage() {
    const hasAccess = useAccountGuard();

    const [passwordForm, setPasswordForm] = useState({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
    });

    const [passwordErrors, setPasswordErrors] = useState({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
        general: "",
    });

    const [savingPassword, setSavingPassword] = useState(false);
    const [passwordSuccess, setPasswordSuccess] = useState("");

    const checks = useMemo(() => {
        const password = passwordForm.newPassword;

        return {
            length: password.length >= 8,
            upper: /[A-Z]/.test(password),
            lower: /[a-z]/.test(password),
            number: /[0-9]/.test(password),
            special: /[^A-Za-z0-9]/.test(password),
        };
    }, [passwordForm.newPassword]);

    const score = Object.values(checks).filter(Boolean).length;
    const allValid = score === 5;

    const passwordsMatch =
        passwordForm.confirmPassword.length > 0 &&
        passwordForm.newPassword === passwordForm.confirmPassword;

    const barPercent = `${(score / 5) * 100}%`;

    const handlePasswordChange = (event) => {
        const { name, value } = event.target;

        setPasswordForm((prev) => ({
            ...prev,
            [name]: value,
        }));

        setPasswordErrors((prev) => ({
            ...prev,
            [name]: "",
            general: "",
        }));

        setPasswordSuccess("");
    };

    const handlePasswordSubmit = async (event) => {
        event.preventDefault();

        const nextErrors = {
            currentPassword: "",
            newPassword: "",
            confirmPassword: "",
            general: "",
        };

        if (!passwordForm.currentPassword) {
            nextErrors.currentPassword = "Current password is required.";
        }

        if (!allValid) {
            nextErrors.newPassword = "Password does not meet all requirements.";
        }

        if (passwordForm.newPassword !== passwordForm.confirmPassword) {
            nextErrors.confirmPassword = "Passwords do not match.";
        }

        if (
            nextErrors.currentPassword ||
            nextErrors.newPassword ||
            nextErrors.confirmPassword
        ) {
            setPasswordErrors(nextErrors);
            return;
        }

        try {
            setSavingPassword(true);
            setPasswordSuccess("");

            await changeMyPassword(passwordForm);

            setPasswordForm({
                currentPassword: "",
                newPassword: "",
                confirmPassword: "",
            });

            setPasswordSuccess("Password updated successfully.");
        } catch (error) {
            setPasswordErrors((prev) => ({
                ...prev,
                [error.field]: error.message,
                general: error.field ? "" : error.message,
            }));
        } finally {
            setSavingPassword(false);
        }
    };

    if (!hasAccess) return null;

    return (
        <div className="dashboard-embedded-page dashboard-embedded-settings">
            <section className="account-settings-hero">
                <div>
                    <p className="account-settings-eyebrow">FastBoost Security</p>
                    <h1>Change Password</h1>
                    <p>
                        Update your account password. Use a strong password to protect your FastBoost account.
                    </p>
                </div>
            </section>

            <div className="change-password-page-grid">
                <section className="account-settings-card">
                    <div className="account-settings-card-header">
                        <h2>Security Details</h2>
                        <p>Enter your current password and choose a new secure password.</p>
                    </div>

                    <form className="account-settings-form" onSubmit={handlePasswordSubmit}>
                        <div className="change-password-layout">
                            <div className="change-password-fields">
                                <label>
                                    Current password
                                    <input
                                        type="password"
                                        name="currentPassword"
                                        value={passwordForm.currentPassword}
                                        onChange={handlePasswordChange}
                                        className={
                                            passwordErrors.currentPassword ? "settings-input-error" : ""
                                        }
                                        placeholder="Current password"
                                    />
                                </label>

                                {passwordErrors.currentPassword && (
                                    <p className="settings-error">
                                        {passwordErrors.currentPassword}
                                    </p>
                                )}

                                <label>
                                    New password
                                    <input
                                        type="password"
                                        name="newPassword"
                                        value={passwordForm.newPassword}
                                        onChange={handlePasswordChange}
                                        className={`${allValid ? "settings-input-valid" : ""} ${passwordErrors.newPassword ? "settings-input-error" : ""
                                            }`}
                                        placeholder="New password"
                                    />
                                </label>

                                {passwordErrors.newPassword && (
                                    <p className="settings-error">
                                        {passwordErrors.newPassword}
                                    </p>
                                )}

                                <label>
                                    Confirm new password
                                    <input
                                        type="password"
                                        name="confirmPassword"
                                        value={passwordForm.confirmPassword}
                                        onChange={handlePasswordChange}
                                        className={`${passwordsMatch ? "settings-input-valid" : ""} ${passwordErrors.confirmPassword ? "settings-input-error" : ""
                                            }`}
                                        placeholder="Confirm new password"
                                    />
                                </label>

                                {passwordErrors.confirmPassword && (
                                    <p className="settings-error">
                                        {passwordErrors.confirmPassword}
                                    </p>
                                )}

                                {passwordErrors.general && (
                                    <p className="settings-error">
                                        {passwordErrors.general}
                                    </p>
                                )}

                                {passwordSuccess && (
                                    <p className="settings-success">
                                        {passwordSuccess}
                                    </p>
                                )}

                                <button
                                    type="submit"
                                    className="settings-primary-btn"
                                    disabled={savingPassword}
                                >
                                    {savingPassword ? "Updating..." : "Update Password"}
                                </button>
                            </div>

                            <aside className="change-password-guide">
                                <h3>Password Requirements</h3>
                                <p>
                                    Use a password that is different from your current password and difficult for others to guess.
                                </p>

                                <div className="password-strength">
                                    <div
                                        className={`password-strength-track ${allValid ? "is-strong" : ""
                                            }`}
                                    >
                                        <div
                                            className="password-strength-cover"
                                            style={{ left: barPercent }}
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
                            </aside>
                        </div>
                    </form>
                </section>
            </div>
        </div>
    );
}