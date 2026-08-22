import { createCheckoutSession } from "../api/orders";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { TwoColumnPageSkeleton } from "../components/PageSkeletons";
import { Skeleton } from "../components/Skeleton";
import { API_BASE_URL } from "../api/config";
import Navbar from "../components/Navbar";
import RegisterPage from "./RegisterPage";
import "../styles/OrderPage.css";

const SERVICES_CACHE_KEY = "fastboost:services:v1";
const SERVICES_CACHE_TTL = 6 * 60 * 60 * 1000;
const CHAMPIONS_CACHE_KEY = "fastboost:champions:v1";
const CHAMPIONS_CACHE_TTL = 24 * 60 * 60 * 1000;

function getCachedService(serviceId) {
  try {
    const raw = localStorage.getItem(SERVICES_CACHE_KEY);

    if (!raw) return null;

    const cached = JSON.parse(raw);

    if (!Array.isArray(cached?.services)) {
      return null;
    }

    const service = cached.services.find(
      (item) => String(item.id) === String(serviceId)
    );

    if (!service) return null;

    const isFresh =
      typeof cached.savedAt === "number" &&
      Date.now() - cached.savedAt < SERVICES_CACHE_TTL;

    return {
      service,
      isFresh,
    };
  } catch {
    return null;
  }
}

function refreshCachedService(updatedService) {
  try {
    const raw = localStorage.getItem(SERVICES_CACHE_KEY);

    // Important:
    // Do not create a partial services cache from OrderPage.
    if (!raw) return;

    const cached = JSON.parse(raw);

    if (!Array.isArray(cached?.services)) {
      return;
    }

    const services = cached.services.map((service) =>
      String(service.id) === String(updatedService.id)
        ? {
          ...service,
          ...updatedService,
        }
        : service
    );

    localStorage.setItem(
      SERVICES_CACHE_KEY,
      JSON.stringify({
        services,
        savedAt: Date.now(),
      })
    );
  } catch {
    // Ignore cache errors.
  }
}

function OrderPage() {
  const navigate = useNavigate();
  const { serviceId } = useParams();

  const [service, setService] = useState(null);
  const [selectedBoostType, setSelectedBoostType] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState("login");

  const [loginForm, setLoginForm] = useState({
    email: "",
    password: "",
  });

  const [registerForm, setRegisterForm] = useState({
    email: "",
    password: "",
    role: "CUSTOMER",
  });

  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotError, setForgotError] = useState(false);

  const [authLoading, setAuthLoading] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [authSuccess, setAuthSuccess] = useState(false);
  const [authSuccessTitle, setAuthSuccessTitle] = useState("");
  const [authSuccessText, setAuthSuccessText] = useState("");

  const [loginErrors, setLoginErrors] = useState({
    email: false,
    password: false,
  });

  const [registerErrors, setRegisterErrors] = useState({
    email: false,
    password: false,
  });

  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const savedUser = localStorage.getItem("user");
      const savedToken = localStorage.getItem("token");

      if (savedUser) return JSON.parse(savedUser);
      if (savedToken) return { email: "Signed in user" };
      return null;
    } catch {
      return null;
    }
  });

  const [showProfileMenu, setShowProfileMenu] = useState(false);

  const hasSession = Boolean(localStorage.getItem("token")) || Boolean(currentUser);

  const [formData, setFormData] = useState({
    currentRank: "Silver I",
    desiredRank: "Gold IV",
    currentLP: "0-20 LP",
    currentMasterLp: 0,
    desiredMasterLp: 50,
    lpGain: "",
    peakRank: "",
    desiredWins: "",
    placementGames: "",
    numberOfGames: "",
    region: "North America",
    queueType: "Solo/Duo",
    playMode: "Solo",
    priorityOrder: false,
    premiumCoaching: false,
    liveStream: false,
    appearOffline: false,
    untrackableDuo: false,
    bonusWin: false,
    soloOnly: false,
    highMMRDuo: false,
    championPreferenceTier: "4+",
  });

  const [paymentLoading, setPaymentLoading] = useState(false);
  const [availableGold, setAvailableGold] = useState(0);
  const [goldToUse, setGoldToUse] = useState(0);

  const [serverQuote, setServerQuote] = useState(null);
  const [priceQuoteLoading, setPriceQuoteLoading] = useState(false);
  const [priceQuoteError, setPriceQuoteError] = useState("");
  const [priceQuoteRefreshKey, setPriceQuoteRefreshKey] = useState(0);

  useEffect(() => {
    const loadGold = async () => {
      const token = localStorage.getItem("token");
      if (!token) return;

      try {
        const response = await fetch(`${API_BASE_URL}/loyalty/me`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json();

        const totalGold =
          data?.totalGold ??
          data?.loyalty?.totalGold ??
          data?.summary?.totalGold ??
          data?.accountProgress?.totalGold ??
          0;

        setAvailableGold(Math.max(0, Number(totalGold || 0)));
      } catch (error) {
        console.error("Failed to load available gold:", error);
      }
    };

    loadGold();
  }, [currentUser]);

  const [isChampionPanelOpen, setIsChampionPanelOpen] = useState(false);
  const [championPreferenceEnabled, setChampionPreferenceEnabled] = useState(false);
  const [championPrefs, setChampionPrefs] = useState({
    firstRole: "Top",
    secondRole: "Fill",
    selectedChampions: [],
  });

  const [allChampions, setAllChampions] = useState([]);
  const [championSearch, setChampionSearch] = useState("");

  useEffect(() => {
    let cancelled = false;

    const cached = getCachedService(serviceId);

    if (cached?.service) {
      setService(cached.service);
      setSelectedBoostType(cached.service.title);
      setLoadError("");
      setLoading(false);
    } else {
      setLoading(true);
    }

    // Fresh HomePage cache = no reason to wait on Render again.
    if (cached?.isFresh) {
      return () => {
        cancelled = true;
      };
    }

    const fetchService = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/services/${serviceId}`
        );

        if (!response.ok) {
          throw new Error("Failed to load service");
        }

        const data = await response.json();
        const normalizedService = data.service || data;

        if (cancelled) return;

        setService(normalizedService);
        setSelectedBoostType(normalizedService.title);
        setLoadError("");

        refreshCachedService(normalizedService);
      } catch (error) {
        if (cancelled) return;

        // If cached data is already visible,
        // don't destroy the page just because refresh failed.
        if (!cached?.service) {
          setLoadError("Could not load this service");
        }
      } finally {
        if (!cancelled && !cached?.service) {
          setLoading(false);
        }
      }
    };

    fetchService();

    return () => {
      cancelled = true;
    };
  }, [serviceId]);

  const serviceType = selectedBoostType || service?.title || "";
  const isTftService = serviceType.startsWith("TFT ");
  const normalizedServiceType = serviceType.replace("TFT ", "");

  useEffect(() => {
    if (!serviceType) return;

    document.title = `${serviceType} | FastBoost`;
  }, [serviceType]);

  useEffect(() => {
    if (!serviceType) return;

    setFormData((prev) => {
      if (normalizedServiceType === "Rank Boost") {
        return {
          ...prev,
          currentLP: "0-20 LP",
          currentMasterLp: 0,
          desiredMasterLp: 50,
          lpGain: "18-23 LP / win",
          peakRank: "", // not applicable
          desiredWins: "",
          placementGames: "",
          numberOfGames: "",
        };
      }

      if (normalizedServiceType === "Placement Boost") {
        return {
          ...prev,
          lpGain: "",
          peakRank: prev.peakRank || "Unranked", // applicable; default to Unranked if empty
          desiredWins: "",
          placementGames: "1",
          numberOfGames: "",
        };
      }

      if (normalizedServiceType === "Win Boost") {
        return {
          ...prev,
          lpGain: "18-23 LP / win",
          peakRank: "", // not applicable
          desiredWins: "1",
          placementGames: "",
          numberOfGames: "",
        };
      }

      if (normalizedServiceType === "Pro Duo") {
        return {
          ...prev,
          lpGain: "18-23 LP / win",
          peakRank: "", // not applicable
          desiredWins: "",
          placementGames: "",
          numberOfGames: "1",
          playMode: "Duo",
        };
      }

      return prev;
    });
  }, [normalizedServiceType]);

  useEffect(() => {
    setServerQuote(null);
  }, [serviceType]);

  useEffect(() => {
    if (!serviceType) return;

    setPriceQuoteLoading(true);
    setPriceQuoteError("");

    const controller = new AbortController();

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/pricing/quote`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            boostType: serviceType,
            currentRank: formData.currentRank,
            desiredRank: formData.desiredRank,
            currentLP: formData.currentLP,
            currentMasterLp: formData.currentMasterLp,
            desiredMasterLp: formData.desiredMasterLp,
            lpGain: formData.lpGain,
            peakRank: formData.peakRank,
            desiredWins: formData.desiredWins,
            placementGames: formData.placementGames,
            numberOfGames: formData.numberOfGames,
            playMode: formData.playMode,
            priorityOrder: formData.priorityOrder,
            premiumCoaching: formData.premiumCoaching,
            liveStream: formData.liveStream,
            appearOffline: formData.appearOffline,
            untrackableDuo: formData.untrackableDuo,
            bonusWin: formData.bonusWin,
            soloOnly: formData.soloOnly,
            highMMRDuo: formData.highMMRDuo,
            championPreferenceTier: formData.championPreferenceTier,
          }),
        });

        const data = await response.json();

        if (!response.ok || data.ok === false) {
          throw new Error(data.message || "Failed to load current price.");
        }

        setServerQuote(data.quote || null);
      } catch (error) {
        if (error.name === "AbortError") return;

        console.error("Failed to load live price:", error);

        setServerQuote(null);
        setPriceQuoteError(
          error.message || "Could not load current pricing."
        );
      } finally {
        if (!controller.signal.aborted) {
          setPriceQuoteLoading(false);
        }
      }
    }, 200);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    serviceType,
    formData.currentRank,
    formData.desiredRank,
    formData.currentLP,
    formData.currentMasterLp,
    formData.desiredMasterLp,
    formData.lpGain,
    formData.peakRank,
    formData.desiredWins,
    formData.placementGames,
    formData.numberOfGames,
    formData.playMode,
    formData.priorityOrder,
    formData.premiumCoaching,
    formData.liveStream,
    formData.appearOffline,
    formData.untrackableDuo,
    formData.bonusWin,
    formData.soloOnly,
    formData.highMMRDuo,
    formData.championPreferenceTier,
    priceQuoteRefreshKey,
  ]);

  useEffect(() => {
    const refreshLivePrice = () => {
      setPriceQuoteRefreshKey((current) => current + 1);
    };

    window.addEventListener("focus", refreshLivePrice);

    return () => {
      window.removeEventListener("focus", refreshLivePrice);
    };
  }, []);

  useEffect(() => {
    if (!isChampionPanelOpen) return;
    if (allChampions.length > 0) return;

    const loadChampions = async () => {
      try {
        const cachedRaw = localStorage.getItem(CHAMPIONS_CACHE_KEY);

        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw);

          const isFresh =
            Array.isArray(cached?.champions) &&
            typeof cached?.savedAt === "number" &&
            Date.now() - cached.savedAt < CHAMPIONS_CACHE_TTL;

          if (isFresh) {
            setAllChampions(cached.champions);
            return;
          }
        }

        const versionResponse = await fetch(
          "https://ddragon.leagueoflegends.com/api/versions.json"
        );
        const versions = await versionResponse.json();
        const latestVersion = versions[0];

        const championResponse = await fetch(
          `https://ddragon.leagueoflegends.com/cdn/${latestVersion}/data/en_US/champion.json`
        );
        const championData = await championResponse.json();

        const champions = Object.values(championData.data).map((champion) => ({
          id: champion.id,
          name: champion.name,
          icon:
            `https://ddragon.leagueoflegends.com/cdn/` +
            `${latestVersion}/img/champion/` +
            `${champion.image.full}`,
        }));

        setAllChampions(champions);

        localStorage.setItem(
          CHAMPIONS_CACHE_KEY,
          JSON.stringify({
            champions,
            savedAt: Date.now(),
          })
        );
      } catch (error) {
        console.error("Failed to load champions:", error);
      }
    };

    loadChampions();
  }, [isChampionPanelOpen, allChampions.length]);

  const isInvalidRankPath = useMemo(() => {
    if (normalizedServiceType !== "Rank Boost") return false;

    const currentTier = getTierFromAnyRank(formData.currentRank);
    const desiredTier = getTierFromAnyRank(formData.desiredRank);

    if (currentTier === "Master" && desiredTier === "Master") {
      return Number(formData.desiredMasterLp) <= Number(formData.currentMasterLp);
    }

    if (currentTier === "Master" && desiredTier !== "Master") {
      return true;
    }

    if (currentTier !== "Master" && desiredTier === "Master") {
      return false;
    }

    return rankOptions.indexOf(formData.desiredRank) <= rankOptions.indexOf(formData.currentRank);
  }, [
    serviceType,
    formData.currentRank,
    formData.desiredRank,
    formData.currentMasterLp,
    formData.desiredMasterLp,
  ]);

  const priceReady = Boolean(serverQuote);

  const basePrice = priceReady
    ? Number(serverQuote.basePrice || 0)
    : 0;

  const addonPrice = priceReady
    ? Number(serverQuote.addonPrice || 0)
    : 0;

  const totalPriceNumber = priceReady
    ? Number(serverQuote.totalPrice || 0)
    : 0;

  const totalPrice = priceReady
    ? totalPriceNumber.toFixed(2)
    : "";
  const totalPriceCents = priceReady
    ? Math.round(totalPriceNumber * 100)
    : 0;

  // 1 gold = $0.10 = 10 cents
  const maxGoldByOrder = Math.floor(totalPriceCents / 10);

  const goldInputText = String(goldToUse ?? "").trim();

  const isGoldEmpty = goldInputText === "";
  const isGoldNumeric = isGoldEmpty || /^\d+$/.test(goldInputText);

  const enteredGoldToUse = isGoldNumeric && !isGoldEmpty
    ? Number(goldInputText)
    : 0;

  const isGoldNegative = false; // text regex blocks minus signs
  const isGoldNotWholeNumber = !isGoldNumeric;
  const isGoldOverAvailable = enteredGoldToUse > availableGold;
  const isGoldOverOrderTotal = enteredGoldToUse > maxGoldByOrder;

  const isGoldInputInvalid =
    isGoldNotWholeNumber ||
    isGoldOverAvailable ||
    isGoldOverOrderTotal;

  const safeGoldToUse = isGoldInputInvalid ? 0 : enteredGoldToUse;
  const goldDiscount = safeGoldToUse * 0.1;
  const finalPrice = Math.max(0, totalPriceNumber - goldDiscount).toFixed(2);

  const goldInputMessage = isGoldNotWholeNumber
    ? "Please enter a whole number of gold."
    : isGoldOverAvailable
      ? `You only have ${availableGold} gold available.`
      : isGoldOverOrderTotal
        ? `You can only use up to ${maxGoldByOrder} gold for this order.`
        : "";

  const coinCount = Math.floor(Number(totalPrice));
  const coinValue = (coinCount * 0.1).toFixed(2);

  const filteredChampions = allChampions.filter((champion) =>
    champion.name.toLowerCase().includes(championSearch.toLowerCase())
  );

  const getSecondRoleOptions = (firstRole) => {
    const roleMap = {
      Top: ["Fill", "Jungle", "Middle", "Bottom", "Support"],
      Jungle: ["Fill", "Top", "Middle", "Bottom", "Support"],
      Middle: ["Fill", "Top", "Jungle", "Bottom", "Support"],
      Bottom: ["Fill", "Top", "Jungle", "Middle", "Support"],
      Support: ["Fill", "Top", "Jungle", "Middle", "Bottom"],
    };

    return roleMap[firstRole] || ["Fill", "Jungle", "Middle", "Bottom", "Support"];
  };

  const handleInputChange = (event) => {
    const { name, value, type, checked } = event.target;

    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const openChampionPanel = () => {
    setChampionPreferenceEnabled(true);
    setIsChampionPanelOpen(true);
  };

  const closeChampionPanel = () => {
    if (championPrefs.selectedChampions.length === 0) {
      setChampionPreferenceEnabled(false);
      setChampionPrefs({
        firstRole: "Top",
        secondRole: "Fill",
        selectedChampions: [],
      });
      setFormData((prev) => ({
        ...prev,
        championPreferenceTier: "4+",
      }));
    }

    setChampionSearch("");
    setIsChampionPanelOpen(false);
  };

  const handleChampionToggle = () => {
    if (championPreferenceEnabled) {
      setChampionPreferenceEnabled(false);
      setChampionPrefs({
        firstRole: "Top",
        secondRole: "Fill",
        selectedChampions: [],
      });
      setFormData((prev) => ({
        ...prev,
        championPreferenceTier: "4+",
      }));
      setIsChampionPanelOpen(false);
      return;
    }

    openChampionPanel();
  };

  const updateChampionTierFromSelection = (selectedChampions) => {
    if (selectedChampions.length <= 1) return "1";
    if (selectedChampions.length <= 3) return "2-3";
    return "4+";
  };

  const handleFirstRoleChange = (newRole) => {
    setChampionPrefs((prev) => {
      if (prev.secondRole === newRole) {
        return {
          ...prev,
          firstRole: newRole,
          secondRole: prev.firstRole,
        };
      }

      return {
        ...prev,
        firstRole: newRole,
      };
    });
  };

  const handleSecondRoleChange = (newRole) => {
    setChampionPrefs((prev) => {
      if (prev.firstRole === newRole) {
        return {
          ...prev,
          firstRole: prev.secondRole,
          secondRole: newRole,
        };
      }

      return {
        ...prev,
        secondRole: newRole,
      };
    });
  };

  const handleSaveChampionSelection = () => {
    if (championPrefs.selectedChampions.length === 0) {
      setChampionPreferenceEnabled(false);
      setChampionPrefs({
        firstRole: "Top",
        secondRole: "Fill",
        selectedChampions: [],
      });
      setFormData((prev) => ({
        ...prev,
        championPreferenceTier: "4+",
      }));
      setChampionSearch("");
      setIsChampionPanelOpen(false);
      return;
    }

    setChampionPreferenceEnabled(true);
    setFormData((prev) => ({
      ...prev,
      championPreferenceTier: updateChampionTierFromSelection(
        championPrefs.selectedChampions
      ),
    }));
    setChampionSearch("");
    setIsChampionPanelOpen(false);
  };

  const addChampion = (champion) => {
    setChampionPrefs((prev) => {
      if (prev.selectedChampions.some((item) => item.id === champion.id)) {
        return prev;
      }

      return {
        ...prev,
        selectedChampions: [...prev.selectedChampions, champion],
      };
    });

    setChampionSearch("");
  };

  const removeChampion = (championId) => {
    setChampionPrefs((prev) => ({
      ...prev,
      selectedChampions: prev.selectedChampions.filter((item) => item.id !== championId),
    }));
  };

  const handleLoginInputChange = (event) => {
    const { name, value } = event.target;

    setLoginForm((prev) => ({
      ...prev,
      [name]: value,
    }));

    setLoginErrors((prev) => ({
      ...prev,
      [name]: false,
    }));

    setAuthMessage("");
  };

  const handleRegisterInputChange = (event) => {
    const { name, value } = event.target;

    setRegisterForm((prev) => ({
      ...prev,
      [name]: value,
    }));

    setRegisterErrors((prev) => ({
      ...prev,
      [name]: false,
    }));

    setAuthMessage("");
  };

  const closeAuthModal = () => {
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

    setLoginForm({ email: "", password: "" });
    setRegisterForm({ email: "", password: "", role: "CUSTOMER" });
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setCurrentUser(null);
    setShowProfileMenu(false);
    try { window.dispatchEvent(new Event("auth:changed")); } catch { }
    navigate("/", { replace: true });
  };

  const finishLogin = ({ token, email, profileImage = "", role = "CUSTOMER" }) => {
    const loggedInUser = { email, profileImage, role };

    localStorage.setItem("token", token || "logged-in");
    sessionStorage.removeItem("fastboost:session-expired-shown");
    localStorage.setItem("user", JSON.stringify(loggedInUser));
    setCurrentUser(loggedInUser);

    setAuthLoading(false);
    setAuthSuccess(true);
    setAuthMessage("");
    setAuthSuccessTitle("Login Successful");
    setAuthSuccessText("Welcome to FastBoost.");

    setTimeout(() => {
      closeAuthModal();
    }, 1200);
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
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(loginForm),
      });

      const data = await response.json();

      if (!response.ok) {
        setLoginErrors({ email: true, password: true });
        setAuthMessage(data.message || "Incorrect email or password");
        return;
      }

      finishLogin({
        token: data?.token,
        email: data?.user?.email || data?.email || loginForm.email,
        profileImage:
          data?.user?.profileImage ||
          data?.user?.avatar ||
          data?.user?.photoUrl ||
          "",
        role: data?.user?.role || "CUSTOMER",
      });
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
      const response = await fetch(`${API_BASE_URL}/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(registerForm),
      });

      const data = await response.json();

      if (!response.ok) {
        setRegisterErrors({ email: true, password: true });
        setAuthMessage(data.message || "Registration failed");
        return;
      }

      finishLogin({
        token: data?.token,
        email: data?.user?.email || data?.email || registerForm.email,
        profileImage:
          data?.user?.profileImage ||
          data?.user?.avatar ||
          data?.user?.photoUrl ||
          "",
        role: data?.user?.role || "CUSTOMER",
      });
    } catch {
      setRegisterErrors({ email: true, password: true });
      setAuthMessage("Could not connect to backend");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    try {
      setSubmitError("");

      if (!serverQuote || priceQuoteLoading) {
        setSubmitError(
          "Current pricing is still loading. Please wait a moment."
        );
        return;
      }

      if (isInvalidRankPath) {
        return;
      }

      if (isGoldInputInvalid) {
        setSubmitError(goldInputMessage || "Please enter a valid gold amount.");
        return;
      }

      const token = localStorage.getItem("token");

      if (!token) {
        setSubmitError("");
        setAuthMode("login");
        setAuthMessage("Please log in to place your order.");
        setAuthSuccess(false);
        setLoginErrors({ email: false, password: false });
        setRegisterErrors({ email: false, password: false });
        setForgotError(false);
        setForgotEmail("");
        setShowAuthModal(true);
        return;
      }

      const response = await fetch(`${API_BASE_URL}/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          serviceId: service.id,
          boostType: serviceType,
          currentRank: formData.currentRank,
          desiredRank: formData.desiredRank,
          currentLP: formData.currentLP,
          currentMasterLp: isMasterRank(formData.currentRank)
            ? Number(formData.currentMasterLp)
            : null,
          desiredMasterLp: isMasterRank(formData.desiredRank)
            ? Number(formData.desiredMasterLp)
            : null,
          lpGain: formData.lpGain || null,
          peakRank: normalizedServiceType === "Placement Boost" ? (formData.peakRank || null) : null,
          desiredWins: formData.desiredWins,
          placementGames: formData.placementGames,
          firstRole:
            championPreferenceEnabled && championPrefs.selectedChampions.length > 0
              ? championPrefs.firstRole
              : null,
          secondRole:
            championPreferenceEnabled && championPrefs.selectedChampions.length > 0
              ? championPrefs.secondRole
              : null,
          selectedChampions:
            championPreferenceEnabled && championPrefs.selectedChampions.length > 0
              ? championPrefs.selectedChampions.map((champion) => champion.name)
              : [],
          numberOfGames: formData.numberOfGames,
          region: formData.region,
          queueType: formData.queueType,
          playMode: formData.playMode,
          priorityOrder: formData.priorityOrder,
          premiumCoaching: formData.premiumCoaching,
          liveStream: formData.liveStream,
          appearOffline: formData.appearOffline,
          untrackableDuo: formData.untrackableDuo,
          championPreferenceTier: formData.championPreferenceTier,
          bonusWin: formData.bonusWin,
          soloOnly: formData.soloOnly,
          highMMRDuo: formData.highMMRDuo,
          basePrice,
          addonPrice,
          totalPrice,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to create order");
      }

      const orderGameMode = isTftService ? "tft" : "lol";

      sessionStorage.setItem(
        `fastboost:order:${data.order.id}:gameMode`,
        orderGameMode
      );

      setPaymentLoading(true);

      const checkout = await createCheckoutSession(
        data.order.id,
        safeGoldToUse
      );

      if (checkout.paidWithGoldOnly && checkout.redirectUrl) {
        window.location.href = checkout.redirectUrl;
        return;
      }

      if (!checkout.checkoutUrl) {
        throw new Error("Checkout URL was not returned");
      }

      window.location.href = checkout.checkoutUrl;
    } catch (error) {
      setSubmitError(error.message || "Could not create order");
    } finally {
      setPaymentLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="order-page-shell order-page-lol">
        <div className="order-page-bg-overlay" />

        <Navbar
          hasSession={hasSession}
          currentUser={currentUser}
          showProfileMenu={showProfileMenu}
          setShowProfileMenu={setShowProfileMenu}
          setAuthMode={setAuthMode}
          setAuthMessage={setAuthMessage}
          setAuthSuccess={setAuthSuccess}
          setLoginErrors={setLoginErrors}
          setRegisterErrors={setRegisterErrors}
          setForgotError={setForgotError}
          setForgotEmail={setForgotEmail}
          setShowAuthModal={setShowAuthModal}
          handleLogout={handleLogout}
        />

        <TwoColumnPageSkeleton />
      </div>
    );
  }

  if (loadError || !service) {
    return (
      <div className="order-page-shell order-page-lol">
        <Navbar
          hasSession={hasSession}
          currentUser={currentUser}
          profileImage={currentUser?.profileImage || ""}
          showProfileMenu={showProfileMenu}
          setShowProfileMenu={setShowProfileMenu}
          setAuthMode={setAuthMode}
          setAuthMessage={setAuthMessage}
          setAuthSuccess={setAuthSuccess}
          setLoginErrors={setLoginErrors}
          setRegisterErrors={setRegisterErrors}
          setForgotError={setForgotError}
          setForgotEmail={setForgotEmail}
          setShowAuthModal={setShowAuthModal}
          handleLogout={handleLogout}
        />
        <div className="order-page-container">
          <p className="error-message">{loadError || "Service not found."}</p>
          <Link to="/" className="secondary-btn details-link-btn">
            Back to homepage
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`order-page-shell ${isTftService ? "order-page-tft" : "order-page-lol"}`}>
      <div className="order-page-bg-overlay" />
      <Navbar
        hasSession={hasSession}
        currentUser={currentUser}
        profileImage={currentUser?.profileImage || ""}
        showProfileMenu={showProfileMenu}
        setShowProfileMenu={setShowProfileMenu}
        setAuthMode={setAuthMode}
        setAuthMessage={setAuthMessage}
        setAuthSuccess={setAuthSuccess}
        setLoginErrors={setLoginErrors}
        setRegisterErrors={setRegisterErrors}
        setForgotError={setForgotError}
        setForgotEmail={setForgotEmail}
        setShowAuthModal={setShowAuthModal}
        handleLogout={handleLogout}
      />

      <div className="order-page-container">
        <div className="order-page-header order-page-header-compact">
          <div>
            <h1 className="order-page-title compact-title">Order summary</h1>
          </div>
        </div>

        <form className="order-layout" onSubmit={handleSubmit}>
          <div className="order-main-column">
            <div className="boost-type-panel">
              <div className="boost-type-tabs">
                {[
                  { value: `${isTftService ? "TFT " : ""}Rank Boost`, label: "Division" },
                  { value: `${isTftService ? "TFT " : ""}Placement Boost`, label: "Placements" },
                  { value: `${isTftService ? "TFT " : ""}Win Boost`, label: "Ranked Wins" },
                  ...(!isTftService
                    ? [{ value: "Pro Duo", label: "Pro Duo" }]
                    : []),
                ].map((type) => (
                  <button
                    key={type.value}
                    type="button"
                    className={`boost-type-tab ${selectedBoostType === type.value ? "active" : ""}`}
                    onClick={() => setSelectedBoostType(type.value)}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            <section className="order-form-panel">
              <div className="order-grid">
                {normalizedServiceType === "Rank Boost" && (
                  <>
                    <div
                      className={`rank-selector-card rank-selector-current rank-card-${getTierFromRank(
                        formData.currentRank
                      ).toLowerCase()}`}
                    >
                      <div className="rank-selector-header">
                        <img
                          src={rankImageMap[getTierFromRank(formData.currentRank)]}
                          alt={formData.currentRank}
                          className="rank-selector-icon"
                        />
                        <div>
                          <h3>Current Rank</h3>
                          <p>Select your current tier and division</p>
                        </div>
                      </div>

                      <div className="rank-tier-grid">
                        {tierOrder.map((tier) => (
                          <button
                            key={`current-${tier}`}
                            type="button"
                            className={`rank-tier-btn rank-tooltip-wrap ${getTierFromRank(formData.currentRank) === tier ? "active" : ""
                              }`}
                            onClick={() =>
                              updateRankSelection(setFormData, "currentRank", tier, null)
                            }
                            aria-label={tier}
                          >
                            <img src={rankImageMap[tier]} alt={tier} />
                            <span className="rank-tooltip">{tier}</span>
                          </button>
                        ))}
                      </div>

                      {getTierFromRank(formData.currentRank) !== "Master" && (
                        <div className="rank-division-row">
                          {divisionOrder.map((division) => (
                            <button
                              key={`current-division-${division}`}
                              type="button"
                              className={`rank-division-btn ${getDivisionFromRank(formData.currentRank) === division ? "active" : ""
                                }`}
                              onClick={() =>
                                updateRankSelection(setFormData, "currentRank", null, division)
                              }
                            >
                              {division}
                            </button>
                          ))}
                        </div>
                      )}

                      {getTierFromRank(formData.currentRank) === "Master" ? (
                        <div className="rank-bottom-selects">
                          <div className="order-field">
                            <label>Current LP</label>
                            <div className="master-lp-stepper">
                              <button
                                type="button"
                                onClick={() =>
                                  setFormData((prev) => ({
                                    ...prev,
                                    currentMasterLp: Math.max(0, (prev.currentMasterLp || 0) - 1),
                                  }))
                                }
                              >
                                -
                              </button>

                              <input
                                type="number"
                                min="0"
                                max="999"
                                value={formData.currentMasterLp}
                                onChange={(event) =>
                                  setFormData((prev) => ({
                                    ...prev,
                                    currentMasterLp: Math.max(
                                      0,
                                      Math.min(999, Number(event.target.value) || 0)
                                    ),
                                  }))
                                }
                                className="master-lp-input"
                              />

                              <button
                                type="button"
                                onClick={() =>
                                  setFormData((prev) => ({
                                    ...prev,
                                    currentMasterLp: Math.min(999, (prev.currentMasterLp || 0) + 1),
                                  }))
                                }
                              >
                                +
                              </button>
                            </div>
                          </div>

                          <div className="order-field">
                            <label>LP per win</label>
                            <select
                              name="lpGain"
                              value={formData.lpGain}
                              onChange={handleInputChange}
                            >
                              <option>0-18 LP / win</option>
                              <option>18-23 LP / win</option>
                              <option>23-28 LP / win</option>
                              <option>28+ LP / win</option>
                            </select>
                          </div>
                        </div>
                      ) : (
                        <div className="rank-bottom-selects">
                          <div className="order-field">
                            <label>Current LP</label>
                            <select
                              name="currentLP"
                              value={formData.currentLP}
                              onChange={handleInputChange}
                            >
                              <option>0-20 LP</option>
                              <option>21-40 LP</option>
                              <option>41-60 LP</option>
                              <option>61-80 LP</option>
                              <option>81-99 LP</option>
                            </select>
                          </div>

                          <div className="order-field">
                            <label>LP per win</label>
                            <select
                              name="lpGain"
                              value={formData.lpGain}
                              onChange={handleInputChange}
                            >
                              <option>0-18 LP / win</option>
                              <option>18-23 LP / win</option>
                              <option>23-28 LP / win</option>
                              <option>28+ LP / win</option>
                            </select>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="rank-selector-divider">↓</div>

                    <div
                      className={`rank-selector-card rank-selector-target rank-card-${getTierFromRank(
                        formData.desiredRank
                      ).toLowerCase()}`}
                    >
                      <div className="rank-selector-header">
                        <img
                          src={rankImageMap[getTierFromRank(formData.desiredRank)]}
                          alt={formData.desiredRank}
                          className="rank-selector-icon"
                        />
                        <div>
                          <h3>Desired Rank</h3>
                          <p>Select your target tier and division</p>
                        </div>
                      </div>

                      <div className="rank-tier-grid">
                        {tierOrder.map((tier) => (
                          <button
                            key={`desired-${tier}`}
                            type="button"
                            className={`rank-tier-btn rank-tooltip-wrap ${getTierFromRank(formData.desiredRank) === tier ? "active" : ""
                              }`}
                            onClick={() =>
                              updateRankSelection(setFormData, "desiredRank", tier, null)
                            }
                          >
                            <img src={rankImageMap[tier]} alt={tier} />
                            <span className="rank-tooltip">{tier}</span>
                          </button>
                        ))}
                      </div>

                      {getTierFromRank(formData.desiredRank) !== "Master" && (
                        <div className="rank-division-row">
                          {divisionOrder.map((division) => (
                            <button
                              key={`desired-division-${division}`}
                              type="button"
                              className={`rank-division-btn ${getDivisionFromRank(formData.desiredRank) === division ? "active" : ""
                                }`}
                              onClick={() =>
                                updateRankSelection(setFormData, "desiredRank", null, division)
                              }
                            >
                              {division}
                            </button>
                          ))}
                        </div>
                      )}

                      {getTierFromRank(formData.desiredRank) === "Master" ? (
                        <>
                          <div className="rank-bottom-selects">
                            <div className="order-field">
                              <label>Desired LP</label>
                              <div className="master-lp-stepper">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setFormData((prev) => ({
                                      ...prev,
                                      desiredMasterLp: Math.max(0, (prev.desiredMasterLp || 0) - 1),
                                    }))
                                  }
                                >
                                  -
                                </button>

                                <input
                                  type="number"
                                  min="0"
                                  max="999"
                                  value={formData.desiredMasterLp}
                                  onChange={(event) =>
                                    setFormData((prev) => ({
                                      ...prev,
                                      desiredMasterLp: Math.max(
                                        0,
                                        Math.min(999, Number(event.target.value) || 0)
                                      ),
                                    }))
                                  }
                                  className="master-lp-input"
                                />

                                <button
                                  type="button"
                                  onClick={() =>
                                    setFormData((prev) => ({
                                      ...prev,
                                      desiredMasterLp: Math.min(999, (prev.desiredMasterLp || 0) + 1),
                                    }))
                                  }
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          </div>

                          <div className="rank-bottom-selects">
                            <div className="order-field">
                              <label>Server</label>
                              <select
                                name="region"
                                value={formData.region}
                                onChange={handleInputChange}
                              >
                                <option>North America</option>
                                <option>Europe West</option>
                                <option>Europe Nordic & East</option>
                                <option>Korea</option>
                                <option>Brazil</option>
                                <option>Latin America North</option>
                                <option>Latin America South</option>
                                <option>Oceania</option>
                                <option>Japan</option>
                              </select>
                            </div>

                            <div className="order-field">
                              <label>Queue Type</label>
                              <select
                                name="queueType"
                                value={formData.queueType}
                                onChange={handleInputChange}
                              >
                                <option>Solo/Duo</option>
                                <option>Flex</option>
                              </select>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="rank-bottom-selects">
                          <div className="order-field">
                            <label>Server</label>
                            <select
                              name="region"
                              value={formData.region}
                              onChange={handleInputChange}
                            >
                              <option>North America</option>
                              <option>Europe West</option>
                              <option>Europe Nordic & East</option>
                              <option>Korea</option>
                              <option>Brazil</option>
                              <option>Latin America North</option>
                              <option>Latin America South</option>
                              <option>Oceania</option>
                              <option>Japan</option>
                            </select>
                          </div>

                          <div className="order-field">
                            <label>Queue Type</label>
                            <select
                              name="queueType"
                              value={formData.queueType}
                              onChange={handleInputChange}
                            >
                              <option>Solo/Duo</option>
                              <option>Flex</option>
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {normalizedServiceType === "Placement Boost" && (
                  <>
                    <div
                      className={`rank-selector-card rank-selector-current placement-selector-card rank-card-${getTierFromAnyRank(
                        formData.peakRank
                      ).toLowerCase()}`}
                    >
                      <div className="rank-selector-header">
                        <img
                          src={rankImageMap[getTierFromAnyRank(formData.peakRank)]}
                          alt={formData.peakRank}
                          className="rank-selector-icon"
                        />

                        <div>
                          <h3>Peak Active Rank</h3>
                          <p>Select your highest rank from last season</p>
                        </div>
                      </div>

                      <div className="placement-tier-rows">
                        <div className="placement-tier-row placement-tier-row-6">
                          {placementTierOrder.slice(0, 6).map((tier) => (
                            <button
                              key={`placement-top-${tier}`}
                              type="button"
                              className={`rank-tier-btn rank-tooltip-wrap ${getTierFromAnyRank(formData.peakRank) === tier ? "active" : ""}`}
                              onClick={() => updatePlacementRankSelection(setFormData, tier)}
                              aria-label={tier}
                            >
                              <img src={rankImageMap[tier]} alt={tier} />
                              <span className="rank-tooltip">{tier}</span>
                            </button>
                          ))}
                        </div>
                        <div className="placement-tier-row placement-tier-row-5">
                          {placementTierOrder.slice(6).map((tier) => (
                            <button
                              key={`placement-bottom-${tier}`}
                              type="button"
                              className={`rank-tier-btn rank-tooltip-wrap ${getTierFromAnyRank(formData.peakRank) === tier ? "active" : ""}`}
                              onClick={() => updatePlacementRankSelection(setFormData, tier)}
                              aria-label={tier}
                            >
                              <img src={rankImageMap[tier]} alt={tier} />
                              <span className="rank-tooltip">{tier}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {getTierFromAnyRank(formData.peakRank) === "Diamond" && (
                        <div className="order-field">
                          <label>Diamond Division</label>

                          <div className="rank-division-row">
                            {divisionOrder.map((division) => (
                              <button
                                key={`placement-diamond-${division}`}
                                type="button"
                                className={`rank-division-btn ${getDivisionFromRank(formData.peakRank) === division
                                  ? "active"
                                  : ""
                                  }`}
                                onClick={() =>
                                  setFormData((prev) => ({
                                    ...prev,
                                    peakRank: `Diamond ${division}`,
                                  }))
                                }
                              >
                                {division}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="placement-options-area">
                        <div className="order-field">
                          <label>Placement Games</label>

                          <div className="placement-games-row">
                            {["1", "2", "3", "4", "5"].map((game) => (
                              <button
                                key={`placement-game-${game}`}
                                type="button"
                                className={`rank-division-btn placement-game-btn ${formData.placementGames === game ? "active" : ""
                                  }`}
                                onClick={() =>
                                  setFormData((prev) => ({
                                    ...prev,
                                    placementGames: game,
                                  }))
                                }
                              >
                                {game}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="placement-server-queue-row">
                          <div className="order-field">
                            <label>Queue Type</label>
                            <select
                              name="queueType"
                              value={formData.queueType}
                              onChange={handleInputChange}
                            >
                              <option>Solo/Duo</option>
                              <option>Flex</option>
                            </select>
                          </div>

                          <div className="order-field">
                            <label>Server</label>
                            <select
                              name="region"
                              value={formData.region}
                              onChange={handleInputChange}
                            >
                              <option>North America</option>
                              <option>Europe West</option>
                              <option>Europe Nordic & East</option>
                              <option>Korea</option>
                              <option>Brazil</option>
                              <option>Latin America North</option>
                              <option>Latin America South</option>
                              <option>Oceania</option>
                              <option>Japan</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {normalizedServiceType === "Win Boost" && (
                  <>
                    <div
                      className={`rank-selector-card rank-selector-current ranked-wins-selector-card rank-card-${getTierFromAnyRank(
                        formData.currentRank
                      ).toLowerCase()}`}
                    >
                      <div className="rank-selector-header">
                        <img
                          src={rankImageMap[getTierFromAnyRank(formData.currentRank)]}
                          alt={formData.currentRank}
                          className="rank-selector-icon"
                        />

                        <div>
                          <h3>Current Rank</h3>
                          <p>Select your current tier and division</p>
                        </div>
                      </div>

                      {/* Two-line layout: 5 tiers on top, 4 below (includes Grandmaster) */}
                      <div className="ranked-wins-tier-rows">
                        <div className="ranked-wins-tier-row ranked-wins-tier-row-5">
                          {tierOrderWithGrandmaster.slice(0, 5).map((tier) => (
                            <button
                              key={`win-current-top-${tier}`}
                              type="button"
                              className={`rank-tier-btn rank-tooltip-wrap ${getTierFromAnyRank(formData.currentRank) === tier ? "active" : ""}`}
                              onClick={() => updateRankSelection(setFormData, "currentRank", tier, null)}
                              aria-label={tier}
                            >
                              <img src={rankImageMap[tier]} alt={tier} />
                              <span className="rank-tooltip">{tier}</span>
                            </button>
                          ))}
                        </div>

                        <div className="ranked-wins-tier-row ranked-wins-tier-row-4">
                          {tierOrderWithGrandmaster.slice(5).map((tier) => (
                            <button
                              key={`win-current-bottom-${tier}`}
                              type="button"
                              className={`rank-tier-btn rank-tooltip-wrap ${getTierFromAnyRank(formData.currentRank) === tier ? "active" : ""}`}
                              onClick={() => updateRankSelection(setFormData, "currentRank", tier, null)}
                              aria-label={tier}
                            >
                              <img src={rankImageMap[tier]} alt={tier} />
                              <span className="rank-tooltip">{tier}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {!["Master", "Grandmaster", "Challenger"].includes(getTierFromAnyRank(formData.currentRank)) && (
                        <div className="rank-division-row">
                          {divisionOrder.map((division) => (
                            <button
                              key={`win-current-division-${division}`}
                              type="button"
                              className={`rank-division-btn ${getDivisionFromRank(formData.currentRank) === division ? "active" : ""
                                }`}
                              onClick={() =>
                                updateRankSelection(setFormData, "currentRank", null, division)
                              }
                            >
                              {division}
                            </button>
                          ))}
                        </div>
                      )}

                      <div className="rank-bottom-selects ranked-wins-current-bottom">
                        <div className="order-field">
                          <label>LP per win</label>
                          <select
                            name="lpGain"
                            value={formData.lpGain}
                            onChange={handleInputChange}
                          >
                            <option>0-18 LP / win</option>
                            <option>18-23 LP / win</option>
                            <option>23-28 LP / win</option>
                            <option>28+ LP / win</option>
                          </select>
                        </div>

                        <div className="order-field">
                          <label>Server</label>
                          <select
                            name="region"
                            value={formData.region}
                            onChange={handleInputChange}
                          >
                            <option>North America</option>
                            <option>Europe West</option>
                            <option>Europe Nordic & East</option>
                            <option>Korea</option>
                            <option>Brazil</option>
                            <option>Latin America North</option>
                            <option>Latin America South</option>
                            <option>Oceania</option>
                            <option>Japan</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    <div className="rank-selector-divider">↓</div>

                    <div
                      className={`rank-selector-card ranked-wins-goal-card rank-card-${getTierFromAnyRank(
                        formData.currentRank
                      ).toLowerCase()}`}
                    >
                      <div className="ranked-wins-goal-header">
                        <div className="ranked-wins-big-number">{formData.desiredWins}</div>

                        <div>
                          <h3>Number of Wins</h3>
                          <p>Select desired games</p>
                        </div>
                      </div>

                      <div className="ranked-wins-slider-wrap">
                        <input
                          type="range"
                          min="1"
                          max="10"
                          step="1"
                          value={Number(formData.desiredWins) || 1}
                          className="ranked-wins-slider"
                          style={{
                            "--wins-progress": `${(((Number(formData.desiredWins) || 1) - 1) / 9) * 100}`,
                          }}
                          onChange={(event) =>
                            setFormData((prev) => ({
                              ...prev,
                              desiredWins: event.target.value,
                            }))
                          }
                        />
                      </div>

                      <div className="rank-bottom-selects ranked-wins-goal-bottom">
                        <div className="order-field">
                          <label>Queue Type</label>
                          <select
                            name="queueType"
                            value={formData.queueType}
                            onChange={handleInputChange}
                          >
                            <option>Solo/Duo</option>
                            <option>Flex</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {normalizedServiceType === "Pro Duo" && (
                  <>
                    <div
                      className={`rank-selector-card rank-selector-current ranked-wins-selector-card rank-card-${getTierFromAnyRank(
                        formData.currentRank
                      ).toLowerCase()}`}
                    >
                      <div className="rank-selector-header">
                        <img
                          src={rankImageMap[getTierFromAnyRank(formData.currentRank)]}
                          alt={formData.currentRank}
                          className="rank-selector-icon"
                        />

                        <div>
                          <h3>Current Rank</h3>
                          <p>Select your current tier and division</p>
                        </div>
                      </div>

                      {/* Two-line layout: 5 tiers on top, 4 below (includes Grandmaster) */}
                      <div className="ranked-wins-tier-rows">
                        <div className="ranked-wins-tier-row ranked-wins-tier-row-5">
                          {tierOrderWithGrandmaster.slice(0, 5).map((tier) => (
                            <button
                              key={`duo-current-top-${tier}`}
                              type="button"
                              className={`rank-tier-btn rank-tooltip-wrap ${getTierFromAnyRank(formData.currentRank) === tier ? "active" : ""}`}
                              onClick={() => updateRankSelection(setFormData, "currentRank", tier, null)}
                              aria-label={tier}
                            >
                              <img src={rankImageMap[tier]} alt={tier} />
                              <span className="rank-tooltip">{tier}</span>
                            </button>
                          ))}
                        </div>

                        <div className="ranked-wins-tier-row ranked-wins-tier-row-4">
                          {tierOrderWithGrandmaster.slice(5).map((tier) => (
                            <button
                              key={`duo-current-bottom-${tier}`}
                              type="button"
                              className={`rank-tier-btn rank-tooltip-wrap ${getTierFromAnyRank(formData.currentRank) === tier ? "active" : ""}`}
                              onClick={() => updateRankSelection(setFormData, "currentRank", tier, null)}
                              aria-label={tier}
                            >
                              <img src={rankImageMap[tier]} alt={tier} />
                              <span className="rank-tooltip">{tier}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {!["Master", "Grandmaster", "Challenger"].includes(getTierFromAnyRank(formData.currentRank)) && (
                        <div className="rank-division-row">
                          {divisionOrder.map((division) => (
                            <button
                              key={`duo-current-division-${division}`}
                              type="button"
                              className={`rank-division-btn ${getDivisionFromRank(formData.currentRank) === division ? "active" : ""}`}
                              onClick={() =>
                                updateRankSelection(setFormData, "currentRank", null, division)
                              }
                            >
                              {division}
                            </button>
                          ))}
                        </div>
                      )}

                      <div className="rank-bottom-selects ranked-wins-current-bottom">
                        <div className="order-field">
                          <label>LP per win</label>
                          <select
                            name="lpGain"
                            value={formData.lpGain}
                            onChange={handleInputChange}
                          >
                            <option>0-18 LP / win</option>
                            <option>18-23 LP / win</option>
                            <option>23-28 LP / win</option>
                            <option>28+ LP / win</option>
                          </select>
                        </div>

                        <div className="order-field">
                          <label>Server</label>
                          <select
                            name="region"
                            value={formData.region}
                            onChange={handleInputChange}
                          >
                            <option>North America</option>
                            <option>Europe West</option>
                            <option>Europe Nordic & East</option>
                            <option>Korea</option>
                            <option>Brazil</option>
                            <option>Latin America North</option>
                            <option>Latin America South</option>
                            <option>Oceania</option>
                            <option>Japan</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    <div className="rank-selector-divider">↓</div>

                    <div
                      className={`rank-selector-card ranked-wins-goal-card rank-card-${getTierFromAnyRank(
                        formData.currentRank
                      ).toLowerCase()}`}
                    >
                      <div className="ranked-wins-goal-header">
                        <div className="ranked-wins-big-number">{formData.numberOfGames}</div>

                        <div>
                          <h3>Number of Games</h3>
                          <p>Select desired games</p>
                        </div>
                      </div>

                      <div className="ranked-wins-slider-wrap">
                        <input
                          type="range"
                          min="1"
                          max="10"
                          step="1"
                          value={Number(formData.numberOfGames) || 1}
                          className="ranked-wins-slider"
                          style={{
                            "--wins-progress": `${(((Number(formData.numberOfGames) || 1) - 1) / 9) * 100}`,
                          }}
                          onChange={(event) =>
                            setFormData((prev) => ({
                              ...prev,
                              numberOfGames: event.target.value,
                            }))
                          }
                        />
                      </div>

                      <div className="rank-bottom-selects ranked-wins-goal-bottom">
                        <div className="order-field">
                          <label>Queue Type</label>
                          <select
                            name="queueType"
                            value={formData.queueType}
                            onChange={handleInputChange}
                          >
                            <option>Solo/Duo</option>
                            <option>Flex</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </>
                )}

              </div>
            </section>
          </div>

          <aside className="order-summary-panel">
            <p className="section-label">Checkout</p>
            <h2 className="order-summary-heading">{serviceType}</h2>

            {normalizedServiceType === "Rank Boost" && (
              <div
                className={`order-rank-track order-rank-strip rank-track-current-${getTierFromAnyRank(
                  formData.currentRank
                ).toLowerCase()} rank-track-target-${getTierFromAnyRank(
                  formData.desiredRank
                ).toLowerCase()}`}
              >
                <div className="order-rank-track-side">
                  <img
                    src={rankImageMap[getTierFromAnyRank(formData.currentRank)]}
                    alt={formData.currentRank}
                    className="order-rank-track-icon"
                  />

                  <div className="order-rank-track-copy">
                    <span className="order-rank-label">Current</span>
                    <div className="order-rank-track-main">
                      <strong>{formData.currentRank}</strong>
                    </div>
                  </div>
                </div>

                <div className="order-rank-arrow">→</div>

                <div className="order-rank-track-side order-rank-track-side-target">
                  <div className="order-rank-track-copy">
                    <span className="order-rank-label order-rank-target-label">Target</span>
                    <div className="order-rank-track-main">
                      <strong>{formData.desiredRank}</strong>
                    </div>
                  </div>

                  <img
                    src={rankImageMap[getTierFromAnyRank(formData.desiredRank)]}
                    alt={formData.desiredRank}
                    className="order-rank-track-icon"
                  />
                </div>
              </div>
            )}

            {normalizedServiceType === "Placement Boost" && (
              <div
                className={`order-rank-strip order-rank-track placement-rank-track rank-track-current-${getTierFromAnyRank(
                  formData.peakRank
                ).toLowerCase()}`}
              >
                <div className="order-rank-track-side placement-track-full">
                  <img
                    src={rankImageMap[getTierFromAnyRank(formData.peakRank)]}
                    alt={formData.peakRank}
                    className="order-rank-track-icon"
                  />

                  <div className="order-rank-track-copy">
                    <span className="order-rank-label">Current</span>

                    <div className="order-rank-track-main">
                      <strong>
                        {formData.placementGames} Placement{" "}
                        {Number(formData.placementGames) === 1 ? "match" : "matches"}{" "}
                        {formatPlacementRankForSummary(formData.peakRank)}
                      </strong>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {normalizedServiceType === "Win Boost" && (
              <div
                className={`order-rank-strip order-rank-track ranked-wins-rank-track rank-track-current-${getTierFromAnyRank(
                  formData.currentRank
                ).toLowerCase()}`}
              >
                <div className="order-rank-track-side placement-track-full">
                  <img
                    src={rankImageMap[getTierFromAnyRank(formData.currentRank)]}
                    alt={formData.currentRank}
                    className="order-rank-track-icon"
                  />

                  <div className="order-rank-track-copy">
                    <span className="order-rank-label">Current</span>

                    <div className="order-rank-track-main">
                      <strong>
                        {formData.desiredWins}{" "}
                        {Number(formData.desiredWins) === 1 ? "win" : "wins"} in {formatWinsRankDisplay(formData.currentRank)}
                      </strong>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {normalizedServiceType === "Pro Duo" && (
              <div
                className={`order-rank-strip order-rank-track ranked-wins-rank-track rank-track-current-${getTierFromAnyRank(
                  formData.currentRank
                ).toLowerCase()}`}
              >
                <div className="order-rank-track-side placement-track-full">
                  <img
                    src={rankImageMap[getTierFromAnyRank(formData.currentRank)]}
                    alt={formData.currentRank}
                    className="order-rank-track-icon"
                  />

                  <div className="order-rank-track-copy">
                    <span className="order-rank-label">Current</span>

                    <div className="order-rank-track-main">
                      <strong>
                        {formData.numberOfGames}{" "}
                        {Number(formData.numberOfGames) === 1 ? "game" : "games"} in {formatWinsRankDisplay(formData.currentRank)}
                      </strong>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {normalizedServiceType !== "Pro Duo" && (
              <div className="summary-mode-strip">
                <button
                  type="button"
                  className={`summary-mode-btn ${formData.playMode === "Solo" ? "active" : ""}`}
                  onClick={() =>
                    setFormData((prev) => ({
                      ...prev,
                      playMode: "Solo",
                      premiumCoaching: false,
                      highMMRDuo: false,
                      untrackableDuo: false,
                    }))
                  }
                >
                  Solo
                </button>

                <button
                  type="button"
                  className={`summary-mode-btn ${formData.playMode === "Duo" ? "active" : ""}`}
                  onClick={() =>
                    setFormData((prev) => ({
                      ...prev,
                      playMode: "Duo",
                      soloOnly: false,
                      appearOffline: false,
                    }))
                  }
                >
                  Duo
                </button>
              </div>
            )}

            <div className="order-addon-panel">
              <div className="order-addon-grid">
                {formData.playMode === "Solo" ? (
                  <>
                    <label className="order-addon-row">
                      <div className="order-addon-copy">
                        <span className="order-addon-name">Stream games</span>
                        <span className="order-addon-badge">Free</span>
                      </div>
                      <span className="order-addon-switch">
                        <input
                          type="checkbox"
                          name="liveStream"
                          checked={formData.liveStream}
                          onChange={handleInputChange}
                        />
                        <span className="order-addon-slider" />
                      </span>
                    </label>

                    <label className="order-addon-row">
                      <div className="order-addon-copy">
                        <span className="order-addon-name">+1 Bonus win</span>
                        <span className="order-addon-badge">By rank</span>
                      </div>
                      <span className="order-addon-switch">
                        <input
                          type="checkbox"
                          name="bonusWin"
                          checked={formData.bonusWin || false}
                          onChange={handleInputChange}
                        />
                        <span className="order-addon-slider" />
                      </span>
                    </label>

                    <label className="order-addon-row">
                      <div className="order-addon-copy">
                        <span className="order-addon-name">Solo Only</span>
                        <span className="order-addon-badge">+30%</span>
                      </div>
                      <span className="order-addon-switch">
                        <input
                          type="checkbox"
                          name="soloOnly"
                          checked={formData.soloOnly || false}
                          onChange={handleInputChange}
                        />
                        <span className="order-addon-slider" />
                      </span>
                    </label>

                    <p className="summary-section-title privacy-title">Privacy Settings</p>

                    <label className="order-addon-row">
                      <div className="order-addon-copy">
                        <span className="order-addon-name">Appear Offline</span>
                        <span className="order-addon-badge neutral">FREE</span>
                      </div>
                      <span className="order-addon-switch">
                        <input
                          type="checkbox"
                          name="appearOffline"
                          checked={formData.appearOffline}
                          onChange={handleInputChange}
                        />
                        <span className="order-addon-slider" />
                      </span>
                    </label>

                    <label className="order-addon-row">
                      <div className="order-addon-copy">
                        <span className="order-addon-name">Roles/Champions</span>
                        <span className="order-addon-badge">
                          {!championPreferenceEnabled
                            ? "Free"
                            : championPrefs.selectedChampions.length === 1
                              ? "+10%"
                              : championPrefs.selectedChampions.length <= 3
                                ? "+5%"
                                : "Free"}
                        </span>
                      </div>
                      <span className="order-addon-switch">
                        <input
                          type="checkbox"
                          checked={championPreferenceEnabled}
                          onChange={handleChampionToggle}
                        />
                        <span className="order-addon-slider" />
                      </span>
                    </label>
                  </>
                ) : (
                  <>
                    <label className="order-addon-row">
                      <div className="order-addon-copy">
                        <span className="order-addon-name">Premium coaching</span>
                        <span className="order-addon-badge">+40%</span>
                      </div>
                      <span className="order-addon-switch">
                        <input
                          type="checkbox"
                          name="premiumCoaching"
                          checked={formData.premiumCoaching}
                          onChange={handleInputChange}
                        />
                        <span className="order-addon-slider" />
                      </span>
                    </label>

                    <label className="order-addon-row">
                      <div className="order-addon-copy">
                        <span className="order-addon-name">High MMR Duo</span>
                        <span className="order-addon-badge">+20%</span>
                      </div>
                      <span className="order-addon-switch">
                        <input
                          type="checkbox"
                          name="highMMRDuo"
                          checked={formData.highMMRDuo || false}
                          onChange={handleInputChange}
                        />
                        <span className="order-addon-slider" />
                      </span>
                    </label>

                    <label className="order-addon-row">
                      <div className="order-addon-copy">
                        <span className="order-addon-name">+1 Bonus win</span>
                        <span className="order-addon-badge">By rank</span>
                      </div>
                      <span className="order-addon-switch">
                        <input
                          type="checkbox"
                          name="bonusWin"
                          checked={formData.bonusWin || false}
                          onChange={handleInputChange}
                        />
                        <span className="order-addon-slider" />
                      </span>
                    </label>

                    <p className="summary-section-title privacy-title">Privacy Settings</p>

                    <label className="order-addon-row">
                      <div className="order-addon-copy">
                        <span className="order-addon-name">Untrackable Duo</span>
                        <span className="order-addon-badge">+30%</span>
                      </div>
                      <span className="order-addon-switch">
                        <input
                          type="checkbox"
                          name="untrackableDuo"
                          checked={formData.untrackableDuo}
                          onChange={handleInputChange}
                        />
                        <span className="order-addon-slider" />
                      </span>
                    </label>
                  </>
                )}
              </div>
            </div>

            <div className="summary-speed-strip">
              <button
                type="button"
                className={`summary-speed-btn ${!formData.priorityOrder ? "active" : ""}`}
                onClick={() =>
                  setFormData((prev) => ({
                    ...prev,
                    priorityOrder: false,
                  }))
                }
              >
                Standard
              </button>

              <button
                type="button"
                className={`summary-speed-btn ${formData.priorityOrder ? "active" : ""}`}
                onClick={() =>
                  setFormData((prev) => ({
                    ...prev,
                    priorityOrder: true,
                  }))
                }
              >
                Express
              </button>
            </div>

            <div className="summary-coins-card">
              <p className="summary-coins-label">You'll earn from this order:</p>

              <div className="summary-coins-main">
                <span className="summary-coins-icon">🪙</span>
                <strong>{coinCount} gold</strong>
              </div>

              <p className="summary-coins-value">= ${coinValue} value</p>
            </div>

            <p className="summary-coins-footnote">
              🪙 10 gold = $1.00 | Earn gold with every order
            </p>

            <div
              className={`summary-gold-redemption-card ${isGoldInputInvalid ? "summary-gold-redemption-card-error" : ""
                }`}
            >
              <div className="summary-gold-redemption-header">
                <span>Use your gold</span>
                <strong>{availableGold} available</strong>
              </div>

              <div className="summary-gold-input-wrap">
                <input
                  type="text"
                  inputMode="numeric"
                  value={goldToUse}
                  onChange={(event) => setGoldToUse(event.target.value)}
                  className={`summary-gold-input ${isGoldInputInvalid ? "summary-gold-input-error" : ""
                    }`}
                  placeholder="0"
                />

                <button
                  type="button"
                  className="summary-gold-max-btn"
                  onClick={() => setGoldToUse(Math.min(availableGold, maxGoldByOrder))}
                >
                  Max
                </button>
              </div>

              <div className="summary-gold-redemption-row">
                <span>{enteredGoldToUse || 0} gold entered</span>
                <strong>
                  -${isGoldInputInvalid ? "0.00" : goldDiscount.toFixed(2)}
                </strong>
              </div>

              {goldInputMessage && (
                <p className="summary-gold-error-text">{goldInputMessage}</p>
              )}

              <p className="summary-coins-footnote">
                Gold is spent only after payment succeeds.
              </p>
            </div>

            {isInvalidRankPath ? (
              <div className="price-warning-box price-warning-box-blocking">
                <p className="price-warning-text">
                  Current rank must be smaller than the desired rank.
                </p>
              </div>
            ) : (
              <>
                <div className="order-summary-total-inline">
                  <div className="order-summary-total-inline-main">
                    <span>Total Price</span>
                    {priceQuoteLoading || !priceReady ? (
                      <Skeleton width={96} height={25} radius={6} />
                    ) : (
                      <strong>${finalPrice}</strong>
                    )}
                  </div>
                </div>

                {submitError && <p className="error-message">{submitError}</p>}
                {priceQuoteError && (
                  <p className="error-message">{priceQuoteError}</p>
                )}

                <button
                  type="submit"
                  className="primary-btn order-submit-btn"
                  disabled={
                    paymentLoading ||
                    priceQuoteLoading ||
                    !priceReady ||
                    isGoldInputInvalid
                  }
                >
                  {paymentLoading
                    ? "Preparing secure payment..."
                    : priceQuoteLoading || !priceReady
                      ? "Updating price..."
                      : "Continue to Secure Payment"}
                </button>
              </>
            )}

          </aside>
        </form>

        {isChampionPanelOpen && (
          <div className="champion-modal-overlay" onClick={closeChampionPanel}>
            <div
              className="champion-modal"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="champion-modal-header">
                <h3>Specific Champions</h3>
                <button
                  type="button"
                  className="champion-modal-close"
                  onClick={closeChampionPanel}
                >
                  ×
                </button>
              </div>

              <div className="champion-modal-body">
                <div className="champion-role-section">
                  <div className="champion-role-header">
                    <span>First role</span>
                    <span className="order-addon-badge neutral">Free</span>
                  </div>

                  <div className="champion-role-tabs champion-role-tabs-5">
                    {[
                      { key: "Top", label: "Top", icon: roleIconMap.Top },
                      { key: "Jungle", label: "Jungle", icon: roleIconMap.Jungle },
                      { key: "Middle", label: "Middle", icon: roleIconMap.Middle },
                      { key: "Bottom", label: "Bottom", icon: roleIconMap.Bottom },
                      { key: "Support", label: "Support", icon: roleIconMap.Support },
                    ].map((role) => (
                      <button
                        key={role.key}
                        type="button"
                        className={`champion-role-tab ${championPrefs.firstRole === role.key ? "active" : ""
                          }`}
                        onClick={() => handleFirstRoleChange(role.key)}
                      >
                        <img src={role.icon} alt={role.label} className="champion-role-icon" />
                        <span>{role.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="champion-role-section">
                  <div className="champion-role-header">
                    <span>Select champion</span>
                    <span className="order-addon-badge">
                      {championPrefs.selectedChampions.length === 1
                        ? "+10%"
                        : championPrefs.selectedChampions.length <= 3
                          ? "+5%"
                          : "Free"}
                    </span>
                  </div>

                  <div className="champion-search-wrap">
                    <input
                      type="text"
                      className="champion-search-input"
                      placeholder={`Search by champion name...`}
                      value={championSearch}
                      onChange={(e) => setChampionSearch(e.target.value)}
                    />

                    {championSearch.trim() && (
                      <div className="champion-search-results">
                        {filteredChampions.slice(0, 12).map((champion) => (
                          <button
                            key={champion.id}
                            type="button"
                            className="champion-search-result"
                            onClick={() => addChampion(champion)}
                          >
                            <img
                              src={champion.icon}
                              alt={champion.name}
                              className="champion-result-icon"
                            />
                            <span>{champion.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="champion-icon-grid">
                    {championPrefs.selectedChampions.map((champion) => (
                      <button
                        key={champion.id}
                        type="button"
                        className="champion-icon-card active"
                        onClick={() => removeChampion(champion.id)}
                      >
                        <img
                          src={champion.icon}
                          alt={champion.name}
                          className="champion-icon-image"
                        />
                        <span>{champion.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="champion-role-section">
                  <div className="champion-role-header">
                    <span>Second role</span>
                    <span className="order-addon-badge neutral">Free</span>
                  </div>

                  <div className="champion-role-tabs champion-role-tabs-5">
                    {getSecondRoleOptions(championPrefs.firstRole).map((roleKey) => {
                      const role = {
                        key: roleKey,
                        label: roleKey,
                        icon: roleIconMap[roleKey],
                      };

                      return (
                        <button
                          key={role.key}
                          type="button"
                          className={`champion-role-tab ${championPrefs.secondRole === role.key ? "active" : ""
                            }`}
                          onClick={() => handleSecondRoleChange(role.key)}
                        >
                          <img src={role.icon} alt={role.label} className="champion-role-icon" />
                          <span>{role.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="champion-modal-footer">
                <button
                  type="button"
                  className="primary-btn champion-save-btn"
                  onClick={handleSaveChampionSelection}
                >
                  Save selection
                </button>
              </div>
            </div>
          </div>
        )}

        <RegisterPage
          showAuthModal={showAuthModal}
          closeAuthModal={closeAuthModal}
          authMode={authMode}
          setAuthMode={setAuthMode}
          authSuccess={authSuccess}
          authSuccessTitle={authSuccessTitle}
          authSuccessText={authSuccessText}
          loginForm={loginForm}
          registerForm={registerForm}
          forgotEmail={forgotEmail}
          forgotError={forgotError}
          authLoading={authLoading}
          authMessage={authMessage}
          loginErrors={loginErrors}
          registerErrors={registerErrors}
          handleLoginInputChange={handleLoginInputChange}
          handleRegisterInputChange={handleRegisterInputChange}
          handleLoginSubmit={handleLoginSubmit}
          handleRegisterSubmit={handleRegisterSubmit}
          setForgotEmail={setForgotEmail}
          setForgotError={setForgotError}
          setAuthMessage={setAuthMessage}
        />

      </div>
    </div>
  );
}

const roleIconMap = {
  Top: "https://fastboost-assets.s3.amazonaws.com/roles/top.png",
  Jungle: "https://fastboost-assets.s3.amazonaws.com/roles/jungle.png",
  Middle: "https://fastboost-assets.s3.amazonaws.com/roles/mid.png",
  Bottom: "https://fastboost-assets.s3.amazonaws.com/roles/bot.png",
  Support: "https://fastboost-assets.s3.amazonaws.com/roles/support.png",
  Fill: "https://fastboost-assets.s3.amazonaws.com/roles/fill.png",
};

const rankImageMap = {
  Unranked: "https://fastboost-assets.s3.amazonaws.com/services/ranks/unranked.webp",
  Iron: "https://fastboost-assets.s3.amazonaws.com/services/ranks/iron.png",
  Bronze: "https://fastboost-assets.s3.amazonaws.com/services/ranks/bronze.png",
  Silver: "https://fastboost-assets.s3.amazonaws.com/services/ranks/silver.png",
  Gold: "https://fastboost-assets.s3.amazonaws.com/services/ranks/gold.png",
  Platinum: "https://fastboost-assets.s3.amazonaws.com/services/ranks/platinum.png",
  Emerald: "https://fastboost-assets.s3.amazonaws.com/services/ranks/emerald.png",
  Diamond: "https://fastboost-assets.s3.amazonaws.com/services/ranks/diamond.png",
  Master: "https://fastboost-assets.s3.amazonaws.com/services/ranks/master.png",
  Grandmaster: "https://fastboost-assets.s3.amazonaws.com/services/ranks/grandmaster.png",
  Challenger: "https://fastboost-assets.s3.amazonaws.com/services/ranks/challenger.png",
};

const tierOrder = [
  "Iron",
  "Bronze",
  "Silver",
  "Gold",
  "Platinum",
  "Emerald",
  "Diamond",
  "Master",
];

// Win Boost: include Grandmaster in selection
const tierOrderWithGrandmaster = [...tierOrder, "Grandmaster"];

const placementTierOrder = [
  "Unranked",
  "Iron",
  "Bronze",
  "Silver",
  "Gold",
  "Platinum",
  "Emerald",
  "Diamond",
  "Master",
  "Grandmaster",
  "Challenger",
];


const placementNoDivisionTiers = ["Unranked", "Master", "Grandmaster", "Challenger"];

const divisionOrder = ["IV", "III", "II", "I"];

function getTierFromRank(rank) {
  return rank.split(" ")[0];
}

function getDivisionFromRank(rank) {
  return rank.split(" ")[1] || "";
}

function buildRankValue(tier, division) {
  if (tier === "Master") return "Master I";
  if (tier === "Grandmaster" || tier === "Challenger" || tier === "Unranked") return tier;
  return `${tier} ${division}`;
}

function updateRankSelection(setFormData, fieldName, nextTier, nextDivision) {
  setFormData((prev) => {
    const currentRank = prev[fieldName];
    const currentTier = getTierFromRank(currentRank);
    const currentDivision = getDivisionFromRank(currentRank) || "I";

    const tier = nextTier || currentTier;
    if (tier === "Grandmaster" || tier === "Challenger" || tier === "Unranked") {
      return { ...prev, [fieldName]: tier };
    }

    const division = tier === "Master" ? "I" : nextDivision || (currentTier === "Master" ? "IV" : currentDivision);

    return {
      ...prev,
      [fieldName]: buildRankValue(tier, division),
    };
  });
}

function updatePlacementRankSelection(setFormData, nextTier) {
  setFormData((prev) => {
    if (nextTier === "Unranked") {
      return {
        ...prev,
        peakRank: "Unranked",
      };
    }

    // Diamond must support IV, III, II, and I because Diamond I costs more.
    if (nextTier === "Diamond") {
      return {
        ...prev,
        peakRank: "Diamond IV",
      };
    }

    // These ranks do not use divisions in the placement selector.
    if (placementNoDivisionTiers.includes(nextTier)) {
      return {
        ...prev,
        peakRank: nextTier,
      };
    }

    return {
      ...prev,
      peakRank: `${nextTier} I`,
    };
  });
}

const rankOptions = [
  "Iron IV",
  "Iron III",
  "Iron II",
  "Iron I",
  "Bronze IV",
  "Bronze III",
  "Bronze II",
  "Bronze I",
  "Silver IV",
  "Silver III",
  "Silver II",
  "Silver I",
  "Gold IV",
  "Gold III",
  "Gold II",
  "Gold I",
  "Platinum IV",
  "Platinum III",
  "Platinum II",
  "Platinum I",
  "Emerald IV",
  "Emerald III",
  "Emerald II",
  "Emerald I",
  "Diamond IV",
  "Diamond III",
  "Diamond II",
  "Diamond I",
];

function getTierFromAnyRank(rank) {
  return (rank || "").split(" ")[0];
}

function isMasterRank(rank) {
  return getTierFromAnyRank(rank) === "Master";
}

function formatRankTrackDisplay(rank, masterLp) {
  const tier = getTierFromAnyRank(rank);

  if (tier === "Master") {
    return `Master ${masterLp} LP`;
  }

  return formatRankForSummary(rank);
}

function formatRankForSummary(rank) {
  const tier = getTierFromAnyRank(rank);

  if (tier === "Master") return "Master";
  if (tier === "Grandmaster") return "Grandmaster";
  if (tier === "Challenger") return "Challenger";

  return rank;
}

function formatPlacementRankForSummary(rank) {
  const tier = getTierFromAnyRank(rank);

  if (rank === "Unranked") return "Unranked";
  if (tier === "Master") return "Master";
  if (tier === "Grandmaster") return "Grandmaster";
  if (tier === "Challenger") return "Challenger";

  return tier;
}


// For Ranked Wins summary: show division for tiers with divisions (Iron → Diamond),
// keep Master/Grandmaster/Challenger/Unranked without division.
function formatWinsRankDisplay(rank) {
  const tier = getTierFromAnyRank(rank);

  if (["Master", "Grandmaster", "Challenger", "Unranked"].includes(tier)) {
    return tier;
  }

  const division = getDivisionFromRank(rank) || "I";
  return `${tier} ${division}`;
}



export default OrderPage;