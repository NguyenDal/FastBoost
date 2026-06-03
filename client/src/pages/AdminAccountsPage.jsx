import { useEffect, useMemo, useRef, useState } from "react";
import Navbar from "../components/Navbar";
import {
    adminListUsers,
    adminUpdateUserRole,
} from "../api/adminUsers";
import "../styles/Admin.css";

const ROLE_OPTIONS = [
    { value: "CUSTOMER", label: "Customer" },
    { value: "PROVIDER", label: "Booster" },
    { value: "ADMIN", label: "Admin" },
];

function formatDate(value) {
    if (!value) return "N/A";

    try {
        return new Date(value).toLocaleString();
    } catch {
        return "N/A";
    }
}

function getStoredUserId() {
    try {
        const user = JSON.parse(localStorage.getItem("user") || "null");
        return user?.id || "";
    } catch {
        return "";
    }
}

export default function AdminAccountsPage() {
    const [query, setQuery] = useState("");
    const [roleFilter, setRoleFilter] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize] = useState(20);
    const [loading, setLoading] = useState(false);
    const [savingUserId, setSavingUserId] = useState("");
    const [error, setError] = useState("");
    const [data, setData] = useState({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
    });

    const [pendingRoleChange, setPendingRoleChange] = useState(null);
    const [confirmSecondsLeft, setConfirmSecondsLeft] = useState(10);
    const [confirmModalStatus, setConfirmModalStatus] = useState("confirm");
    const confirmIntervalRef = useRef(null);
    const successTimeoutRef = useRef(null);

    const currentUserId = getStoredUserId();

    const totalPages = useMemo(() => {
        return Math.max(1, Math.ceil((data?.total || 0) / pageSize));
    }, [data?.total, pageSize]);

    const loadUsers = async () => {
        setLoading(true);
        setError("");

        try {
            const res = await adminListUsers({
                page,
                pageSize,
                q: query.trim(),
                role: roleFilter,
            });

            setData(res);
        } catch (err) {
            setError(err?.message || "Failed to load users");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadUsers();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, pageSize, roleFilter]);

    const handleSearchSubmit = (event) => {
        event.preventDefault();
        setPage(1);
        loadUsers();
    };

    const closeRoleConfirmModal = () => {
        if (confirmIntervalRef.current) {
            clearInterval(confirmIntervalRef.current);
            confirmIntervalRef.current = null;
        }

        if (successTimeoutRef.current) {
            clearTimeout(successTimeoutRef.current);
            successTimeoutRef.current = null;
        }

        setPendingRoleChange(null);
        setConfirmSecondsLeft(10);
        setConfirmModalStatus("confirm");
    };

    const handleRoleChange = (user, nextRole) => {
        if (!nextRole || nextRole === user.role) return;

        const isSelf = user.id === currentUserId;

        if (isSelf && nextRole !== "ADMIN") {
            setError("You cannot remove your own admin access.");
            return;
        }

        setError("");
        setSuccess("");
        setConfirmSecondsLeft(10);
        setConfirmModalStatus("confirm");

        setPendingRoleChange({
            user,
            nextRole,
            previousRole: user.role,
            updatedUser: null,
        });
    };

    useEffect(() => {
        if (!pendingRoleChange || confirmModalStatus !== "confirm") return;

        if (confirmIntervalRef.current) {
            clearInterval(confirmIntervalRef.current);
        }

        confirmIntervalRef.current = setInterval(() => {
            setConfirmSecondsLeft((prev) => {
                if (prev <= 1) {
                    clearInterval(confirmIntervalRef.current);
                    confirmIntervalRef.current = null;
                    setPendingRoleChange(null);
                    setConfirmModalStatus("confirm");
                    return 10;
                }

                return prev - 1;
            });
        }, 1000);

        return () => {
            if (confirmIntervalRef.current) {
                clearInterval(confirmIntervalRef.current);
                confirmIntervalRef.current = null;
            }
        };
    }, [pendingRoleChange, confirmModalStatus]);

    const confirmRoleChange = async () => {
        if (!pendingRoleChange) return;

        const { user, nextRole } = pendingRoleChange;

        if (confirmIntervalRef.current) {
            clearInterval(confirmIntervalRef.current);
            confirmIntervalRef.current = null;
        }

        setConfirmModalStatus("saving");
        setSavingUserId(user.id);
        setError("");
        setSuccess("");

        try {
            const res = await adminUpdateUserRole(user.id, nextRole);
            const updatedUser = res.user;

            setData((prev) => ({
                ...prev,
                items: prev.items.map((item) =>
                    item.id === updatedUser.id ? updatedUser : item
                ),
            }));

            setPendingRoleChange((prev) => ({
                ...prev,
                updatedUser,
            }));

            setConfirmModalStatus("success");

            successTimeoutRef.current = setTimeout(() => {
                closeRoleConfirmModal();
            }, 5000);
        } catch (err) {
            setConfirmModalStatus("confirm");
            setError(err?.message || "Failed to update user role");
            setConfirmSecondsLeft(10);
        } finally {
            setSavingUserId("");
        }
    };

    return (
        <div className="page-shell">
            <Navbar />

            <main className="page-container">
                <section className="admin-list-hero">
                    <div>
                        <p className="admin-eyebrow">FastBoost Admin</p>
                        <h1 className="admin-order-title">Account Management</h1>
                        <p className="admin-list-subtitle">
                            Search users and update account privileges for customers, boosters, and admins.
                        </p>
                    </div>

                    <div className="admin-list-stats">
                        <div className="admin-stat-card">
                            <span>Total Users</span>
                            <strong>{data.total}</strong>
                        </div>
                        <div className="admin-stat-card">
                            <span>Current Page</span>
                            <strong>{page}</strong>
                        </div>
                    </div>
                </section>

                <form className="admin-toolbar premium-toolbar account-toolbar" onSubmit={handleSearchSubmit}>
                    <input
                        placeholder="Search username, email, or display name"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        className="admin-input"
                    />

                    <select
                        value={roleFilter}
                        onChange={(event) => {
                            setRoleFilter(event.target.value);
                            setPage(1);
                        }}
                        className="admin-select"
                    >
                        <option value="">All Roles</option>
                        <option value="CUSTOMER">Customer</option>
                        <option value="PROVIDER">Booster</option>
                        <option value="ADMIN">Admin</option>
                    </select>

                    <button className="primary-btn account-search-btn" type="submit">
                        Search
                    </button>
                </form>

                {error && <p className="admin-feedback admin-feedback-error">{error}</p>}

                {loading ? (
                    <p className="muted-text">Loading users...</p>
                ) : (
                    <div className="admin-table-wrap premium-table-wrap">
                        <table className="admin-table account-table">
                            <thead>
                                <tr>
                                    <th>User</th>
                                    <th>Email</th>
                                    <th>Verified</th>
                                    <th>Current Role</th>
                                    <th>Change Privilege</th>
                                    <th>Created</th>
                                </tr>
                            </thead>

                            <tbody>
                                {data.items.map((user) => {
                                    const displayName =
                                        user.username ||
                                        user.profile?.displayName ||
                                        "No username";

                                    const isSelf = user.id === currentUserId;

                                    return (
                                        <tr key={user.id}>
                                            <td>
                                                <div className="account-user-cell">
                                                    <div className="account-avatar">
                                                        {user.profile?.profileImageUrl ? (
                                                            <img
                                                                src={user.profile.profileImageUrl}
                                                                alt={displayName}
                                                            />
                                                        ) : (
                                                            <span>{displayName.slice(0, 1).toUpperCase()}</span>
                                                        )}
                                                    </div>

                                                    <div>
                                                        <strong>{displayName}</strong>
                                                        {isSelf && <small className="self-badge">You</small>}
                                                    </div>
                                                </div>
                                            </td>

                                            <td>
                                                <span className="account-email">{user.email}</span>
                                            </td>

                                            <td>
                                                <span className={`account-pill ${user.emailVerifiedAt ? "verified" : "unverified"}`}>
                                                    {user.emailVerifiedAt ? "Verified" : "Unverified"}
                                                </span>
                                            </td>

                                            <td>
                                                <RoleBadge role={user.role} />
                                            </td>

                                            <td>
                                                <select
                                                    value={user.role}
                                                    disabled={savingUserId === user.id || isSelf}
                                                    onChange={(event) => handleRoleChange(user, event.target.value)}
                                                    className="admin-select role-change-select"
                                                    title={isSelf ? "You cannot change your own role here" : "Change user role"}
                                                >
                                                    {ROLE_OPTIONS.map((option) => (
                                                        <option key={option.value} value={option.value}>
                                                            {option.label}
                                                        </option>
                                                    ))}
                                                </select>

                                                {savingUserId === user.id && (
                                                    <small className="saving-text">Saving...</small>
                                                )}
                                            </td>

                                            <td>{formatDate(user.createdAt)}</td>
                                        </tr>
                                    );
                                })}

                                {data.items.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="admin-empty">
                                            No users found
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}

                <div className="admin-pagination">
                    <span>Total: {data.total}</span>

                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <button
                            className="secondary-btn"
                            disabled={page <= 1}
                            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                        >
                            Prev
                        </button>

                        <span>{page} / {totalPages}</span>

                        <button
                            className="secondary-btn"
                            disabled={page >= totalPages}
                            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                        >
                            Next
                        </button>
                    </div>
                </div>
            </main>
            {pendingRoleChange && (
                <div
                    className="role-confirm-backdrop"
                    onClick={confirmModalStatus === "saving" ? undefined : closeRoleConfirmModal}
                >
                    <div className="role-confirm-modal" onClick={(event) => event.stopPropagation()}>
                        <div className="role-confirm-timer-wrap">
                            {confirmModalStatus === "success" ? (
                                <div className="role-success-check">
                                    <svg viewBox="0 0 52 52" aria-hidden="true">
                                        <circle className="role-success-circle" cx="26" cy="26" r="24" />
                                        <path className="role-success-mark" d="M15 27.5L22.5 35L38 18" />
                                    </svg>
                                </div>
                            ) : confirmModalStatus === "saving" ? (
                                <div className="role-saving-spinner">
                                    <span></span>
                                </div>
                            ) : (
                                <div
                                    className="role-confirm-timer"
                                    style={{
                                        "--progress": `${(confirmSecondsLeft / 10) * 360}deg`,
                                    }}
                                >
                                    <span>{confirmSecondsLeft}</span>
                                </div>
                            )}
                        </div>

                        <div className="role-confirm-content">
                            <p className="admin-eyebrow">
                                {confirmModalStatus === "success"
                                    ? "Privilege Updated"
                                    : confirmModalStatus === "saving"
                                        ? "Updating Privilege"
                                        : "Confirm Privilege Change"}
                            </p>

                            {confirmModalStatus === "success" ? (
                                <>
                                    <h2>Role updated successfully</h2>
                                    <p>
                                        <strong>
                                            {pendingRoleChange.updatedUser?.username ||
                                                pendingRoleChange.updatedUser?.email ||
                                                pendingRoleChange.user.username ||
                                                pendingRoleChange.user.email}
                                        </strong>{" "}
                                        is now{" "}
                                        <strong>
                                            {pendingRoleChange.updatedUser?.role || pendingRoleChange.nextRole}
                                        </strong>.
                                    </p>
                                </>
                            ) : confirmModalStatus === "saving" ? (
                                <>
                                    <h2>Updating account role...</h2>
                                    <p>
                                        Please wait while FastBoost updates this account privilege.
                                    </p>
                                </>
                            ) : (
                                <>
                                    <h2>Change account role?</h2>

                                    <p>
                                        You are about to change{" "}
                                        <strong>
                                            {pendingRoleChange.user.username || pendingRoleChange.user.email}
                                        </strong>{" "}
                                        from <strong>{pendingRoleChange.previousRole}</strong> to{" "}
                                        <strong>{pendingRoleChange.nextRole}</strong>.
                                    </p>

                                    <p className="role-confirm-warning">
                                        This will update what the account can access after refresh or next login.
                                        If you do nothing, this confirmation will automatically cancel.
                                    </p>
                                </>
                            )}
                        </div>

                        {confirmModalStatus === "confirm" && (
                            <div className="role-confirm-actions">
                                <button
                                    type="button"
                                    className="role-confirm-btn no"
                                    onClick={closeRoleConfirmModal}
                                >
                                    No, cancel
                                </button>

                                <button
                                    type="button"
                                    className="role-confirm-btn yes"
                                    onClick={confirmRoleChange}
                                >
                                    Yes, change role
                                </button>
                            </div>
                        )}

                        {confirmModalStatus === "success" && (
                            <div className="role-confirm-actions one">
                                <button
                                    type="button"
                                    className="role-confirm-btn yes"
                                    onClick={closeRoleConfirmModal}
                                >
                                    Done
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function RoleBadge({ role }) {
    const className =
        role === "ADMIN"
            ? "role-badge role-admin"
            : role === "PROVIDER"
                ? "role-badge role-provider"
                : "role-badge role-customer";

    const label =
        role === "ADMIN"
            ? "Admin"
            : role === "PROVIDER"
                ? "Booster"
                : "Customer";

    return <span className={className}>{label}</span>;
}