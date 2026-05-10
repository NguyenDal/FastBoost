import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import {
    getMyAccount,
    updateMyAccount,
    changeMyPassword,
    uploadProfilePicture,
} from "../api/accountSettings";
import { getStoredUser, hasValidSession } from "../utils/authSession";
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

export default function AccountSettingsPage() {
    const hasAccess = useAccountGuard();

    const [accountForm, setAccountForm] = useState({
        username: "",
        email: "",
        profileImageUrl: "",
    });

    const [passwordForm, setPasswordForm] = useState({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
    });

    const [accountErrors, setAccountErrors] = useState({
        username: "",
        email: "",
        general: "",
    });

    const [passwordErrors, setPasswordErrors] = useState({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
        general: "",
    });

    const [loading, setLoading] = useState(true);
    const [uploadingImage, setUploadingImage] = useState(false);
    const [imageUploadError, setImageUploadError] = useState("");
    const [savingAccount, setSavingAccount] = useState(false);
    const [savingPassword, setSavingPassword] = useState(false);
    const [accountSuccess, setAccountSuccess] = useState("");
    const [passwordSuccess, setPasswordSuccess] = useState("");
    const profileImageInputRef = useRef(null);

    useEffect(() => {
        if (!hasAccess) return;

        const loadAccount = async () => {
            try {
                setLoading(true);

                const user = await getMyAccount();

                setAccountForm({
                    username: user?.username || "",
                    email: user?.email || "",
                    profileImageUrl:
                        user?.profile?.profileImageUrl ||
                        user?.profileImage ||
                        "",
                });
            } catch (error) {
                setAccountErrors((prev) => ({
                    ...prev,
                    general: error.message || "Failed to load account settings.",
                }));
            } finally {
                setLoading(false);
            }
        };

        loadAccount();
    }, [hasAccess]);

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

    const handleAccountChange = (event) => {
        const { name, value } = event.target;

        setAccountForm((prev) => ({
            ...prev,
            [name]: value,
        }));

        setAccountErrors((prev) => ({
            ...prev,
            [name]: "",
            general: "",
        }));

        setAccountSuccess("");
    };

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

    const handleProfileImageFileChange = async (event) => {
        const file = event.target.files?.[0];

        if (!file) return;

        setImageUploadError("");
        setAccountSuccess("");

        const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];

        if (!allowedTypes.includes(file.type)) {
            setImageUploadError("Only JPG, PNG, WEBP, or GIF images are allowed.");
            return;
        }

        if (file.size > 2 * 1024 * 1024) {
            setImageUploadError("Profile picture must be 2MB or smaller.");
            return;
        }

        try {
            setUploadingImage(true);

            const data = await uploadProfilePicture(file);

            setAccountForm((prev) => ({
                ...prev,
                profileImageUrl: data.imageUrl,
            }));

            localStorage.setItem("user", JSON.stringify(data.user));

            try {
                window.dispatchEvent(
                    new CustomEvent("auth:changed", {
                        detail: {
                            user: data.user,
                            profileImageUrl: data.imageUrl,
                        },
                    })
                );
            } catch { }


        } catch (error) {
            setImageUploadError(error.message || "Failed to upload profile picture.");
        } finally {
            setUploadingImage(false);
            event.target.value = "";
        }
    };

    const handleAccountSubmit = async (event) => {
        event.preventDefault();

        const nextErrors = {
            username: "",
            email: "",
            general: "",
        };

        if (!accountForm.username.trim()) {
            nextErrors.username = "Username is required.";
        }

        if (!accountForm.email.trim()) {
            nextErrors.email = "Email is required.";
        }

        if (nextErrors.username || nextErrors.email) {
            setAccountErrors(nextErrors);
            return;
        }

        try {
            setSavingAccount(true);
            setAccountSuccess("");

            const updatedUser = await updateMyAccount({
                username: accountForm.username,
                email: accountForm.email,
                profileImageUrl: accountForm.profileImageUrl,
            });

            localStorage.setItem("user", JSON.stringify(updatedUser));

            try {
                window.dispatchEvent(
                    new CustomEvent("auth:changed", {
                        detail: {
                            user: updatedUser,
                            profileImageUrl:
                                updatedUser?.profile?.profileImageUrl ||
                                updatedUser?.profileImage ||
                                "",
                        },
                    })
                );
            } catch { }

            setAccountSuccess("Account updated successfully.");
        } catch (error) {
            setAccountErrors((prev) => ({
                ...prev,
                [error.field]: error.message,
                general: error.field ? "" : error.message,
            }));
        } finally {
            setSavingAccount(false);
        }
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

    const previewImage = accountForm.profileImageUrl?.trim();

    if (!hasAccess) return null;

    return (
        <div className="account-settings-shell">
            <Navbar />

            <main className="account-settings-container">
                <section className="account-settings-hero">
                    <div>
                        <p className="account-settings-eyebrow">FastBoost Account</p>
                        <h1>Account Settings</h1>
                        <p>
                            Manage your profile picture, username, email, and account password.
                        </p>
                    </div>

                    <div className="account-preview-card">
                        <button
                            type="button"
                            className={`account-preview-avatar avatar-upload-trigger ${uploadingImage ? "is-uploading" : ""
                                }`}
                            onClick={() => profileImageInputRef.current?.click()}
                            disabled={uploadingImage}
                            aria-label="Change profile picture"
                        >
                            {previewImage ? (
                                <img src={previewImage} alt="Profile preview" />
                            ) : (
                                <span>👤</span>
                            )}

                            <span className="avatar-upload-overlay" aria-hidden="true">
                                <span className="avatar-upload-icon">
                                    <svg
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        xmlns="http://www.w3.org/2000/svg"
                                    >
                                        <path
                                            d="M12 15V6"
                                            stroke="currentColor"
                                            strokeWidth="2.2"
                                            strokeLinecap="round"
                                        />
                                        <path
                                            d="M8.5 9.5L12 6L15.5 9.5"
                                            stroke="currentColor"
                                            strokeWidth="2.2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        />
                                        <path
                                            d="M6 15.5V17.5C6 18.3284 6.67157 19 7.5 19H16.5C17.3284 19 18 18.3284 18 17.5V15.5"
                                            stroke="currentColor"
                                            strokeWidth="2.2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        />
                                    </svg>
                                </span>
                            </span>
                        </button>

                        <input
                            ref={profileImageInputRef}
                            className="hidden-profile-file-input"
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            onChange={handleProfileImageFileChange}
                            disabled={uploadingImage}
                        />

                        <strong>
                            {accountForm.username ||
                                getStoredUser()?.username ||
                                "Your account"}
                        </strong>

                        <small>{accountForm.email}</small>
                    </div>
                </section>

                {loading ? (
                    <p className="account-settings-muted">Loading account settings...</p>
                ) : (
                    <div className="account-settings-grid">
                        <section className="account-settings-card">
                            <div className="account-settings-card-header">
                                <h2>Profile Details</h2>
                                <p>Update your username, email, and profile picture.</p>
                            </div>

                            <form className="account-settings-form" onSubmit={handleAccountSubmit}>
                                <label>
                                    Username
                                    <input
                                        type="text"
                                        name="username"
                                        value={accountForm.username}
                                        onChange={handleAccountChange}
                                        className={accountErrors.username ? "settings-input-error" : ""}
                                        placeholder="Username"
                                    />
                                </label>

                                {accountErrors.username && (
                                    <p className="settings-error">{accountErrors.username}</p>
                                )}

                                <label>
                                    Email
                                    <input
                                        type="email"
                                        name="email"
                                        value={accountForm.email}
                                        onChange={handleAccountChange}
                                        className={accountErrors.email ? "settings-input-error" : ""}
                                        placeholder="Email"
                                    />
                                </label>

                                {accountErrors.email && (
                                    <p className="settings-error">{accountErrors.email}</p>
                                )}

                                {accountErrors.general && (
                                    <p className="settings-error">{accountErrors.general}</p>
                                )}

                                {accountSuccess && (
                                    <p className="settings-success">{accountSuccess}</p>
                                )}

                                <button
                                    type="submit"
                                    className="settings-primary-btn"
                                    disabled={savingAccount}
                                >
                                    {savingAccount ? "Saving..." : "Save Profile"}
                                </button>
                            </form>
                        </section>

                        <section className="account-settings-card">
                            <div className="account-settings-card-header">
                                <h2>Change Password</h2>
                                <p>Use a strong password to protect your account.</p>
                            </div>

                            <form className="account-settings-form" onSubmit={handlePasswordSubmit}>
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

                                {passwordErrors.newPassword && (
                                    <p className="settings-error">{passwordErrors.newPassword}</p>
                                )}

                                <label>
                                    Confirm new password
                                    <input
                                        type="password"
                                        name="confirmPassword"
                                        value={passwordForm.confirmPassword}
                                        onChange={handlePasswordChange}
                                        className={`${passwordsMatch ? "settings-input-valid" : ""} ${passwordErrors.confirmPassword
                                            ? "settings-input-error"
                                            : ""
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
                                    <p className="settings-error">{passwordErrors.general}</p>
                                )}

                                {passwordSuccess && (
                                    <p className="settings-success">{passwordSuccess}</p>
                                )}

                                <button
                                    type="submit"
                                    className="settings-primary-btn"
                                    disabled={savingPassword}
                                >
                                    {savingPassword ? "Updating..." : "Update Password"}
                                </button>
                            </form>
                        </section>
                    </div>
                )}
            </main>
        </div>
    );
}