import { useState } from 'react';
import { storeAuthSession } from '../utils/authStorage';
import { notifyAuthChanged } from '../utils/authSession';
import { API_BASE_URL } from '../api/config';

// Share the existing in-page authentication flow without replacing the page.
export default function useAuthModal() {
    const [showAuthModal, setShowAuthModal] = useState(false);
    const [authMode, setAuthMode] = useState("login");
    const [loginForm, setLoginForm] = useState({ email: "", password: "", rememberMe: false });
    const [registerForm, setRegisterForm] = useState({
        email: "",
        password: "",
        role: "CUSTOMER",
        username: "",
        confirmPassword: "",
    });
    const [forgotEmail, setForgotEmail] = useState("");
    const [forgotError, setForgotError] = useState(false);
    const [authLoading, setAuthLoading] = useState(false);
    const [authMessage, setAuthMessage] = useState("");
    const [authSuccess, setAuthSuccess] = useState(false);
    const [authSuccessTitle, setAuthSuccessTitle] = useState("");
    const [authSuccessText, setAuthSuccessText] = useState("");
    const [loginErrors, setLoginErrors] = useState({ email: false, password: false });
    const [registerErrors, setRegisterErrors] = useState({ email: false, password: false });

    const resetAuthState = () => {
        setShowAuthModal(false);
        setAuthMode("login");
        setAuthLoading(false);
        setAuthMessage("");
        setAuthSuccess(false);
        setAuthSuccessTitle("");
        setAuthSuccessText("");
        setForgotEmail("");
        setForgotError(false);
        setLoginErrors({ email: false, password: false });
        setRegisterErrors({ email: false, password: false });
        setLoginForm({ email: "", password: "", rememberMe: false });
        setRegisterForm({
            email: "",
            password: "",
            role: "CUSTOMER",
            username: "",
            confirmPassword: "",
        });
    };

    const handleLoginInputChange = (event) => {
        const { name, value, type, checked } = event.target;
        setLoginForm((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
        setLoginErrors((prev) => ({ ...prev, [name]: false }));
        setAuthMessage("");
    };

    const handleRegisterInputChange = (event) => {
        const { name, value, type, checked } = event.target;
        setRegisterForm((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
        setRegisterErrors((prev) => ({ ...prev, [name]: false }));
        setAuthMessage("");
    };

    const finishLogin = (data, rememberMe = (data.rememberMe ?? loginForm.rememberMe) === true) => {
        const user = {
            ...(data?.user || {}),
            email: data?.user?.email || data?.email || loginForm.email,
            role: data?.user?.role || "CUSTOMER",
        };

        storeAuthSession(data.token, user, rememberMe);
        notifyAuthChanged({ user });
        setAuthSuccess(true);
        setAuthSuccessTitle("Login Successful");
        setAuthSuccessText("Welcome to FastBoost.");

        window.setTimeout(resetAuthState, 350);
    };

    const handleLoginSubmit = async (event) => {
        event.preventDefault();
        setAuthLoading(true);
        setAuthMessage("");
        setAuthSuccess(false);
        setLoginErrors({ email: false, password: false });

        try {
            const response = await fetch(`${API_BASE_URL}/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(loginForm),
            });
            const data = await response.json();

            if (!response.ok) {
                setLoginErrors({ email: true, password: true });
                setAuthMessage(data.message || "Incorrect email or password");
                return;
            }

            finishLogin(data);
        } catch {
            setLoginErrors({ email: true, password: true });
            setAuthMessage("Could not connect to backend");
        } finally {
            setAuthLoading(false);
        }
    };

    const handleRegisterSubmit = async (event) => {
        event.preventDefault();
        setAuthLoading(true);
        setAuthMessage("");
        setAuthSuccess(false);
        setRegisterErrors({ email: false, password: false });

        try {
            const { email, password, role, username, termsAccepted, promotionalEmails } = registerForm;
            const response = await fetch(`${API_BASE_URL}/auth/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password, role, username, termsAccepted: termsAccepted === true, promotionalEmails: promotionalEmails === true }),
            });
            const data = await response.json();

            if (!response.ok) {
                setRegisterErrors({ email: true, password: true });
                setAuthMessage(data.message || "Registration failed");
                return;
            }

            if (data?.token) {
                finishLogin(data, false);
                return;
            }

            const loginResponse = await fetch(`${API_BASE_URL}/auth/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
            });
            const loginData = await loginResponse.json();

            if (!loginResponse.ok) {
                setAuthSuccess(true);
                setAuthSuccessTitle("Registration Successful");
                setAuthSuccessText("Your account was created. Please login.");
                window.setTimeout(() => {
                    setAuthSuccess(false);
                    setAuthMode("login");
                    setLoginForm({ email, password: "", rememberMe: false });
                }, 350);
                return;
            }

            finishLogin(loginData, false);
        } catch {
            setRegisterErrors({ email: true, password: true });
            setAuthMessage("Could not connect to backend");
        } finally {
            setAuthLoading(false);
        }
    };

    const handleForgotPasswordSubmit = async (event) => {
        event.preventDefault();
        setAuthLoading(true);
        setAuthMessage("");
        setForgotError(false);
        setAuthSuccess(false);

        try {
            const response = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: forgotEmail }),
            });
            const data = await response.json();

            if (!response.ok) {
                setForgotError(true);
                setAuthMessage(data.message || "Could not send reset link");
                return;
            }

            setAuthSuccess(true);
            setAuthSuccessTitle("Reset Link Sent");
            setAuthSuccessText("Check your email for the password reset link.");
            window.setTimeout(resetAuthState, 1200);
        } catch {
            setForgotError(true);
            setAuthMessage("Could not connect to backend");
        } finally {
            setAuthLoading(false);
        }
    };

    return {
        navbarProps: {
            setAuthMode,
            setAuthMessage,
            setAuthSuccess,
            setLoginErrors,
            setRegisterErrors,
            setForgotError,
            setForgotEmail,
            setShowAuthModal,
        },
        modalProps: {
            onSocialSuccess: finishLogin,
            showAuthModal,
            closeAuthModal: resetAuthState,
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
        },
    };
}
