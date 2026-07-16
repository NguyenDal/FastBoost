import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { GenericPageSkeleton } from "../components/PageSkeletons";
import {
    getMyAccount,
    updateMyAccount,
    uploadProfilePicture,
    sendEmailVerificationCode,
    confirmEmailVerificationCode,
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
        emailVerified: false,
        profileImageUrl: "",
        discord: "",
        country: "",
        birthday: "",
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
    const [accountSuccess, setAccountSuccess] = useState("");
    const [emailCodeDigits, setEmailCodeDigits] = useState(["", "", "", "", "", ""]);
    const [emailCooldown, setEmailCooldown] = useState(0);
    const emailCodeInputRefs = useRef([]);

    const [verificationMessage, setVerificationMessage] = useState("");
    const [verificationError, setVerificationError] = useState("");
    const [verificationBoxState, setVerificationBoxState] = useState("idle");
    // idle | error | success
    const [showEmailVerificationPanel, setShowEmailVerificationPanel] = useState(false);
    const [emailPanelClosing, setEmailPanelClosing] = useState(false);

    const [sendingEmailCode, setSendingEmailCode] = useState(false);
    const [confirmingEmailCode, setConfirmingEmailCode] = useState(false);
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
                    emailVerified: Boolean(user?.emailVerified),
                    discord: user?.profile?.discord || "",
                    country: user?.profile?.country || "",
                    birthday: user?.profile?.birthday
                        ? new Date(user.profile.birthday).toISOString().slice(0, 10)
                        : "",
                });

                setShowEmailVerificationPanel(!Boolean(user?.emailVerified));

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

    useEffect(() => {
        if (emailCooldown <= 0) return;

        const timer = setTimeout(() => {
            setEmailCooldown((prev) => Math.max(0, prev - 1));
        }, 1000);

        return () => clearTimeout(timer);
    }, [emailCooldown]);

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

            try {
                window.dispatchEvent(
                    new CustomEvent("profile-image:uploading", {
                        detail: {
                            uploading: true,
                        },
                    })
                );
            } catch { }

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

            try {
                window.dispatchEvent(
                    new CustomEvent("profile-image:uploading", {
                        detail: {
                            uploading: false,
                        },
                    })
                );
            } catch { }

            event.target.value = "";
        }
    };

    const handleAccountSubmit = async (event) => {
        event.preventDefault();

        const nextErrors = {
            username: "",
            email: "",
            birthday: "",
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
                discord: accountForm.discord,
                country: accountForm.country,
                birthday: accountForm.birthday,
            });

            syncUpdatedUser(updatedUser);

            setVerificationBoxState("idle");
            setEmailCodeDigits(["", "", "", "", "", ""]);
            setVerificationError("");
            setVerificationMessage("");

            if (!updatedUser?.emailVerified) {
                setEmailPanelClosing(false);
                setShowEmailVerificationPanel(true);
            }

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

    const syncUpdatedUser = (updatedUser) => {
        if (!updatedUser) return;

        setAccountForm((prev) => ({
            ...prev,
            username: updatedUser?.username || "",
            email: updatedUser?.email || "",
            profileImageUrl:
                updatedUser?.profile?.profileImageUrl ||
                updatedUser?.profileImage ||
                "",
            emailVerified: Boolean(updatedUser?.emailVerified),
            discord: updatedUser?.profile?.discord || "",
            country: updatedUser?.profile?.country || "",
            birthday: updatedUser?.profile?.birthday
                ? new Date(updatedUser.profile.birthday).toISOString().slice(0, 10)
                : "",
        }));

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

        if (!updatedUser?.emailVerified) {
            setShowEmailVerificationPanel(true);
            setEmailPanelClosing(false);
        }
    };

    const getCodeValue = (digits) => digits.join("");

    const handleCodeDigitChange = ({ value, index }) => {
        const digit = value.replace(/\D/g, "").slice(-1);

        setVerificationBoxState("idle");
        setVerificationError("");

        setEmailCodeDigits((prev) => {
            const next = [...prev];
            next[index] = digit;

            const fullCode = next.join("");

            if (digit && index < 5) {
                setTimeout(() => {
                    emailCodeInputRefs.current[index + 1]?.focus();
                }, 0);
            }

            if (fullCode.length === 6 && next.every(Boolean)) {
                setTimeout(() => {
                    handleConfirmEmailCode(fullCode);
                }, 80);
            }

            return next;
        });
    };

    const handleCodeKeyDown = ({ event, index }) => {
        if (event.key !== "Backspace") return;

        setEmailCodeDigits((prev) => {
            const next = [...prev];

            if (next[index]) {
                next[index] = "";
                return next;
            }

            if (index > 0) {
                setTimeout(() => {
                    emailCodeInputRefs.current[index - 1]?.focus();
                }, 0);
            }

            return next;
        });
    };

    const handleCodePaste = (event) => {
        event.preventDefault();

        const pasted = event.clipboardData
            .getData("text")
            .replace(/\D/g, "")
            .slice(0, 6);

        if (!pasted) return;

        setVerificationBoxState("idle");
        setVerificationError("");

        const digits = pasted.split("");
        const next = ["", "", "", "", "", ""];

        digits.forEach((digit, index) => {
            next[index] = digit;
        });

        setEmailCodeDigits(next);

        if (next.every(Boolean)) {
            setTimeout(() => handleConfirmEmailCode(next.join("")), 80);
        } else {
            setTimeout(() => {
                emailCodeInputRefs.current[digits.length]?.focus();
            }, 0);
        }
    };

    const renderCodeBoxes = ({ digits, disabled }) => {
        return (
            <div className={`verification-code-boxes ${verificationBoxState === "error"
                ? "is-error"
                : verificationBoxState === "success"
                    ? "is-success"
                    : ""
                }`}>
                {digits.map((digit, index) => (
                    <input
                        key={`email-code-${index}`}
                        ref={(element) => {
                            emailCodeInputRefs.current[index] = element;
                        }}
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={1}
                        value={digit}
                        disabled={disabled}
                        onChange={(event) =>
                            handleCodeDigitChange({
                                value: event.target.value,
                                index,
                            })
                        }
                        onKeyDown={(event) =>
                            handleCodeKeyDown({
                                event,
                                index,
                            })
                        }
                        onPaste={handleCodePaste}
                        aria-label={`email verification digit ${index + 1}`}
                    />
                ))}
            </div>
        );
    };

    const handleSendEmailCode = async () => {
        try {
            setSendingEmailCode(true);
            setVerificationError("");
            setVerificationMessage("");

            const data = await sendEmailVerificationCode();

            setEmailCodeDigits(["", "", "", "", "", ""]);
            setEmailCooldown(60);

            setTimeout(() => {
                emailCodeInputRefs.current[0]?.focus();
            }, 80);
        } catch (error) {
            setVerificationError(error.message || "Failed to send email code.");
        } finally {
            setSendingEmailCode(false);
        }
    };

    const handleConfirmEmailCode = async (submittedCode = getCodeValue(emailCodeDigits)) => {
        try {
            if (submittedCode.length !== 6) return;

            setConfirmingEmailCode(true);
            setVerificationError("");
            setVerificationMessage("");
            setVerificationBoxState("idle");

            const data = await confirmEmailVerificationCode(submittedCode);

            setVerificationBoxState("success");

            setTimeout(() => {
                setEmailPanelClosing(true);
            }, 450);

            setTimeout(() => {
                if (data.user) {
                    syncUpdatedUser(data.user);
                }

                setEmailCodeDigits(["", "", "", "", "", ""]);
                setVerificationBoxState("idle");
                setShowEmailVerificationPanel(false);
                setEmailPanelClosing(false);
            }, 950);
        } catch (error) {
            setVerificationBoxState("error");
            setEmailCodeDigits(["", "", "", "", "", ""]);

            setTimeout(() => {
                emailCodeInputRefs.current[0]?.focus();
            }, 80);
        } finally {
            setConfirmingEmailCode(false);
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
                        <h1>Profile Settings</h1>
                        <p>
                            Manage your profile picture, username, email, Discord, country, and birthday.
                        </p>
                    </div>

                    <div className="account-preview-card">
                        <button
                            type="button"
                            className={`account-preview-avatar avatar-upload-trigger ${uploadingImage ? "is-uploading avatar-loading" : ""
                                }`}
                            onClick={() => profileImageInputRef.current?.click()}
                            disabled={uploadingImage}
                            aria-label="Change profile picture"
                        >
                            <span className="avatar-image-frame">
                                {previewImage ? (
                                    <img src={previewImage} alt="Profile preview" />
                                ) : (
                                    <span className="avatar-fallback-icon">👤</span>
                                )}
                            </span>

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
                    <GenericPageSkeleton />
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
                                    <span className="settings-label-row">
                                        Email
                                        <span className={`verification-pill compact ${accountForm.emailVerified ? "is-verified" : "is-unverified"}`}>
                                            {accountForm.emailVerified ? "Verified" : "Not verified"}
                                        </span>
                                    </span>

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

                                {showEmailVerificationPanel && (
                                    <div className={`verification-action-panel ${emailPanelClosing ? "is-closing" : "is-opening"}`}>
                                        <button
                                            type="button"
                                            className="settings-secondary-btn"
                                            onClick={handleSendEmailCode}
                                            disabled={sendingEmailCode || emailCooldown > 0}
                                        >
                                            {sendingEmailCode
                                                ? "Sending..."
                                                : emailCooldown > 0
                                                    ? `Resend in ${emailCooldown}s`
                                                    : "Send Email Code"}
                                        </button>

                                        {renderCodeBoxes({
                                            digits: emailCodeDigits,
                                            disabled: confirmingEmailCode,
                                        })}
                                    </div>
                                )}

                                {verificationMessage && (
                                    <p className="settings-success">{verificationMessage}</p>
                                )}

                                <div className="settings-form-row two-columns">
                                    <label>
                                        Discord
                                        <input
                                            type="text"
                                            name="discord"
                                            value={accountForm.discord}
                                            onChange={handleAccountChange}
                                            placeholder="Discord username"
                                        />
                                    </label>

                                    <label>
                                        Country
                                        <input
                                            type="text"
                                            name="country"
                                            value={accountForm.country}
                                            onChange={handleAccountChange}
                                            placeholder="Country"
                                        />
                                    </label>
                                </div>

                                <div className="settings-form-row two-columns">
                                    <label>
                                        Birthday
                                        <input
                                            type="date"
                                            name="birthday"
                                            value={accountForm.birthday}
                                            onChange={handleAccountChange}
                                            className={accountErrors.birthday ? "settings-input-error" : ""}
                                        />
                                    </label>

                                    <div className="settings-info-box">
                                        <strong>Birthday discount</strong>
                                        <p>
                                            Birthday rewards are not active yet, but this helps us prepare future birthday discounts.
                                        </p>
                                    </div>
                                </div>

                                {accountErrors.birthday && (
                                    <p className="settings-error">{accountErrors.birthday}</p>
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
                    </div>
                )}
            </main>
        </div>
    );
}