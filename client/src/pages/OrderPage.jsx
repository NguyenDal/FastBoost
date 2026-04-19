import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import "../App.css";

function OrderPage() {
  const navigate = useNavigate();
  const { serviceId } = useParams();

  const [service, setService] = useState(null);
  const [selectedBoostType, setSelectedBoostType] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [submitError, setSubmitError] = useState("");

  const [formData, setFormData] = useState({
    currentRank: "Silver I",
    desiredRank: "Gold IV",
    currentLP: "0-20 LP",
    peakRank: "Unranked",
    desiredWins: "",
    placementGames: "",
    preferredRole: "Middle",
    numberOfGames: "",
    region: "North America",
    queueType: "Solo/Duo",
    playMode: "Solo",
    priorityOrder: false,
    duoWithBooster: false,
    liveStream: false,
    appearOffline: false,
    bonusWin: false,
    soloOnly: false,
    highMMRDuo: false,
    championPreferenceTier: "4+",
  });

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
    const fetchService = async () => {
      try {
        const response = await fetch(`http://localhost:5000/api/services/${serviceId}`);

        if (!response.ok) {
          throw new Error("Failed to load service");
        }

        const data = await response.json();
        const normalizedService = data.service || data;
        setService(normalizedService);
        setSelectedBoostType(normalizedService.title);
      } catch (error) {
        setLoadError("Could not load this service");
      } finally {
        setLoading(false);
      }
    };

    fetchService();
  }, [serviceId]);

  const serviceType = selectedBoostType || service?.title || "";
  
  useEffect(() => {
    if (!serviceType) return;

    setFormData((prev) => {
      if (serviceType === "Rank Boost") {
        return {
          ...prev,
          desiredWins: "",
          placementGames: "",
          numberOfGames: "",
        };
      }

      if (serviceType === "Placement Boost") {
        return {
          ...prev,
          placementGames: "1",
          desiredWins: "",
          numberOfGames: "",
        };
      }

      if (serviceType === "Win Boost") {
        return {
          ...prev,
          desiredWins: "1",
          placementGames: "",
          numberOfGames: "",
        };
      }

      if (serviceType === "Pro Duo") {
        return {
          ...prev,
          numberOfGames: "1",
          placementGames: "",
          desiredWins: "",
        };
      }

      return prev;
    });
  }, [serviceType]);

  useEffect(() => {
    const loadChampions = async () => {
      try {
        const versionResponse = await fetch("https://ddragon.leagueoflegends.com/api/versions.json");
        const versions = await versionResponse.json();
        const latestVersion = versions[0];

        const championResponse = await fetch(
          `https://ddragon.leagueoflegends.com/cdn/${latestVersion}/data/en_US/champion.json`
        );
        const championData = await championResponse.json();

        const champions = Object.values(championData.data).map((champion) => ({
          id: champion.id,
          name: champion.name,
          icon: `https://ddragon.leagueoflegends.com/cdn/${latestVersion}/img/champion/${champion.image.full}`,
        }));

        setAllChampions(champions);
      } catch (error) {
        console.error("Failed to load champions:", error);
      }
    };

    loadChampions();
  }, []);

  

  const isInvalidRankPath =
    serviceType === "Rank Boost" &&
    rankOptions.indexOf(formData.desiredRank) <= rankOptions.indexOf(formData.currentRank);

  const basePrice = useMemo(() => {
    if (serviceType === "Rank Boost") {
      return calculateRankBoostPrice(
        formData.currentRank,
        formData.desiredRank,
        formData.currentLP
      );
    }

    if (serviceType === "Placement Boost") {
      return calculatePlacementBoostPrice(
        formData.peakRank,
        Number(formData.placementGames)
      );
    }

    if (serviceType === "Win Boost") {
      return calculateWinBoostPrice(
        formData.currentRank,
        formData.currentLP,
        Number(formData.desiredWins)
      );
    }

    if (serviceType === "Pro Duo") {
      return calculateProDuoPrice(
        formData.currentRank,
        formData.currentLP,
        Number(formData.numberOfGames)
      );
    }

    return 0;
  }, [
    serviceType,
    formData.currentRank,
    formData.desiredRank,
    formData.currentLP,
    formData.peakRank,
    formData.placementGames,
    formData.desiredWins,
    formData.numberOfGames,
  ]);

  const addonPrice = useMemo(() => {
    let total = 0;

    if (formData.priorityOrder) total += basePrice * 0.15;
    if (formData.playMode === "Duo" && formData.duoWithBooster) {
      total += basePrice * 0.4;
    }
    if (formData.soloOnly) total += basePrice * 0.3;
    if (formData.highMMRDuo) total += basePrice * 0.2;

    if (formData.bonusWin) {
      total += getBonusWinPriceByRank(formData.currentRank);
    }

    total += getChampionPreferencePrice(basePrice, formData.championPreferenceTier);

    return total;
  }, [
    basePrice,
    formData.priorityOrder,
    formData.duoWithBooster,
    formData.soloOnly,
    formData.highMMRDuo,
    formData.bonusWin,
    formData.currentRank,
    formData.championPreferenceTier,
  ]);

  const totalPrice = (basePrice + addonPrice).toFixed(2);

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

  const handleSubmit = async (event) => {
    event.preventDefault();

    try {
      setSubmitError("");

      if (isInvalidRankPath) {
        return;
      }

      const token = localStorage.getItem("token");

      if (!token) {
        setSubmitError("Please log in before placing an order.");
        return;
      }

      const response = await fetch("http://localhost:5000/api/orders", {
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
          peakRank: formData.peakRank,
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
          duoWithBooster: formData.duoWithBooster,
          liveStream: formData.liveStream,
          appearOffline: formData.appearOffline,
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

      navigate(`/match/${data.order.id}`);
    } catch (error) {
      setSubmitError(error.message || "Could not create order");
    }
  };

  if (loading) {
    return (
      <div className="order-page-shell">
        <div className="order-page-container">
          <p className="info-message">Loading service...</p>
        </div>
      </div>
    );
  }

  if (loadError || !service) {
    return (
      <div className="order-page-shell">
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
    <div className="order-page-shell">
      <div className="order-page-bg-overlay" />

      <div className="order-page-container">
        <div className="order-page-topbar">
          <Link to="/" className="order-page-brand">
            <div className="brand-icon">F</div>
            <div>
              <p className="brand-title">FastBoost</p>
              <p className="brand-subtitle">Order Configurator</p>
            </div>
          </Link>

          <Link to="/" className="order-cancel-btn">
            Back
          </Link>
        </div>

        <div className="order-page-header order-page-header-compact">
          <div>
            <h1 className="order-page-title compact-title">Order summary</h1>
          </div>

          <div className="order-header-badges">
            <div className="order-header-badge order-header-badge-green">74+ online now</div>
            <div className="order-header-badge">~ 0-1 days</div>
          </div>
        </div>

        <form className="order-layout" onSubmit={handleSubmit}>
          <section className="order-form-panel">
            <div className="order-grid">

              <div className="order-field order-field-wide">
                <div className="boost-type-tabs">
                  {[
                    { value: "Rank Boost", label: "Division" },
                    { value: "Placement Boost", label: "Placements" },
                    { value: "Win Boost", label: "Ranked Wins" },
                    { value: "Pro Duo", label: "Pro Duo" },
                  ].map((type) => (
                    <button
                      key={type.value}
                      type="button"
                      className={`boost-type-tab ${serviceType === type.value ? "active" : ""}`}
                      onClick={() => setSelectedBoostType(type.value)}
                    >
                      {type.label}
                    </button>
                  ))}
                </div>
              </div>

              {serviceType === "Rank Boost" && (
                <>
                  <div className="rank-selector-card rank-selector-current">
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
                          className={`rank-tier-btn ${getTierFromRank(formData.currentRank) === tier ? "active" : ""
                            }`}
                          onClick={() =>
                            updateRankSelection(setFormData, "currentRank", tier, null)
                          }
                        >
                          <img src={rankImageMap[tier]} alt={tier} />
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

                  <div className="rank-selector-divider">↓</div>

                  <div className="rank-selector-card rank-selector-target">
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
                          className={`rank-tier-btn ${getTierFromRank(formData.desiredRank) === tier ? "active" : ""
                            }`}
                          onClick={() =>
                            updateRankSelection(setFormData, "desiredRank", tier, null)
                          }
                        >
                          <img src={rankImageMap[tier]} alt={tier} />
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

                  </div>
                </>
              )}

              {serviceType === "Placement Boost" && (
                <>
                  <div className="order-field order-field-wide">
                    <label>Peak Active Rank</label>
                    <select
                      name="peakRank"
                      value={formData.peakRank}
                      onChange={handleInputChange}
                    >
                      <option>Unranked</option>
                      {rankOptions.map((rank) => (
                        <option key={rank} value={rank}>
                          {rank}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="order-field order-field-wide">
                    <label>Placement Games</label>
                    <select
                      name="placementGames"
                      value={formData.placementGames}
                      onChange={handleInputChange}
                    >
                      <option>1</option>
                      <option>2</option>
                      <option>3</option>
                      <option>4</option>
                      <option>5</option>
                    </select>
                  </div>
                </>
              )}

              {serviceType === "Win Boost" && (
                <>
                  <div className="order-field order-field-wide">
                    <label>Current Division</label>
                    <select
                      name="currentRank"
                      value={formData.currentRank}
                      onChange={handleInputChange}
                    >
                      {rankOptions.map((rank) => (
                        <option key={rank} value={rank}>
                          {rank}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="order-field order-field-wide">
                    <label>Desired Wins</label>
                    <select
                      name="desiredWins"
                      value={formData.desiredWins}
                      onChange={handleInputChange}
                    >
                      <option>1</option>
                      <option>2</option>
                      <option>3</option>
                      <option>4</option>
                      <option>5</option>
                      <option>10</option>
                    </select>
                  </div>
                </>
              )}

              {serviceType === "Pro Duo" && (
                <>
                  <div className="order-field order-field-wide">
                    <label>Number of Games</label>
                    <select
                      name="numberOfGames"
                      value={formData.numberOfGames}
                      onChange={handleInputChange}
                    >
                      <option>1</option>
                      <option>2</option>
                      <option>3</option>
                      <option>5</option>
                      <option>10</option>
                    </select>
                  </div>
                </>
              )}

              {serviceType !== "Rank Boost" && (
                <>
                  <div className="order-field">
                    <label>Region</label>
                    <select
                      name="region"
                      value={formData.region}
                      onChange={handleInputChange}
                    >
                      <option>North America</option>
                      <option>Europe West</option>
                      <option>Europe Nordic & East</option>
                      <option>Korea</option>
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
                </>
              )}


            </div>
          </section>

          <aside className="order-summary-panel">
            <p className="section-label">Checkout</p>
            <h2 className="order-summary-heading">{serviceType}</h2>

            {serviceType === "Rank Boost" && (
              <div className="order-rank-strip">
                <div className="order-rank-box">
                  <span className="order-rank-label">Current</span>
                  <strong>{formData.currentRank}</strong>
                </div>

                <div className="order-rank-arrow">→</div>

                <div className="order-rank-box order-rank-target">
                  <span className="order-rank-label">Target</span>
                  <strong>{formData.desiredRank}</strong>
                </div>
              </div>
            )}

            {serviceType !== "Rank Boost" && (
              <p className="order-summary-subtitle">
                Review your setup before placing the order.
              </p>
            )}
            <div className="summary-mode-strip">
              <button
                type="button"
                className={`summary-mode-btn ${formData.playMode === "Solo" ? "active" : ""}`}
                onClick={() =>
                  setFormData((prev) => ({
                    ...prev,
                    playMode: "Solo",
                    duoWithBooster: false,
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
                  }))
                }
              >
                Duo
              </button>
            </div>

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
                          name="duoWithBooster"
                          checked={formData.duoWithBooster}
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
                          name="appearOffline"
                          checked={formData.appearOffline}
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

            <div className="summary-save-bar">
              <span>Go higher and save $6 on your order!</span>
            </div>

            <div className="order-summary-list">
              <div className="order-summary-row">
                <span>Region</span>
                <strong>{formData.region}</strong>
              </div>

              <div className="order-summary-row">
                <span>Queue</span>
                <strong>{formData.queueType}</strong>
              </div>

              {serviceType === "Placement Boost" && (
                <div className="order-summary-row">
                  <span>Placements</span>
                  <strong>{formData.placementGames} Games</strong>
                </div>
              )}

              {serviceType === "Win Boost" && (
                <div className="order-summary-row">
                  <span>Wins</span>
                  <strong>{formData.desiredWins}</strong>
                </div>
              )}

              {serviceType === "Pro Duo" && (
                <div className="order-summary-row">
                  <span>Games</span>
                  <strong>{formData.numberOfGames}</strong>
                </div>
              )}
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
                    <strong>${totalPrice}</strong>
                  </div>
                </div>

                {submitError && <p className="error-message">{submitError}</p>}

                <button type="submit" className="primary-btn order-submit-btn">
                  Continue
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
  Iron: "https://fastboost-assets.s3.amazonaws.com/services/ranks/iron.png",
  Bronze: "https://fastboost-assets.s3.amazonaws.com/services/ranks/bronze.png",
  Silver: "https://fastboost-assets.s3.amazonaws.com/services/ranks/silver.png",
  Gold: "https://fastboost-assets.s3.amazonaws.com/services/ranks/gold.png",
  Platinum: "https://fastboost-assets.s3.amazonaws.com/services/ranks/platinum.png",
  Emerald: "https://fastboost-assets.s3.amazonaws.com/services/ranks/emerald.png",
  Diamond: "https://fastboost-assets.s3.amazonaws.com/services/ranks/diamond.png",
  Master: "https://fastboost-assets.s3.amazonaws.com/services/ranks/master.png",
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

const divisionOrder = ["IV", "III", "II", "I"];

function getTierFromRank(rank) {
  return rank.split(" ")[0];
}

function getDivisionFromRank(rank) {
  return rank.split(" ")[1] || "";
}

function buildRankValue(tier, division) {
  if (tier === "Master") return "Master I";
  return `${tier} ${division}`;
}

function updateRankSelection(setFormData, fieldName, nextTier, nextDivision) {
  setFormData((prev) => {
    const currentRank = prev[fieldName];
    const currentTier = getTierFromRank(currentRank);
    const currentDivision = getDivisionFromRank(currentRank) || "I";

    const tier = nextTier || currentTier;
    const division =
      tier === "Master"
        ? "I"
        : nextDivision || (currentTier === "Master" ? "IV" : currentDivision);

    return {
      ...prev,
      [fieldName]: buildRankValue(tier, division),
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

function getRankStepDifference(currentRank, desiredRank) {
  const currentIndex = rankOptions.indexOf(currentRank);
  const desiredIndex = rankOptions.indexOf(desiredRank);

  if (currentIndex === -1 || desiredIndex === -1 || desiredIndex <= currentIndex) {
    return 1;
  }

  return desiredIndex - currentIndex;
}

const divisionStepPrices = {
  "Iron IV": 8,
  "Iron III": 8,
  "Iron II": 8,
  "Iron I": 8,
  "Bronze IV": 8,
  "Bronze III": 8,
  "Bronze II": 8,
  "Bronze I": 8,
  "Silver IV": 10,
  "Silver III": 10,
  "Silver II": 10,
  "Silver I": 10,
  "Gold IV": 12,
  "Gold III": 14,
  "Gold II": 16,
  "Gold I": 18,
  "Platinum IV": 20,
  "Platinum III": 22,
  "Platinum II": 24,
  "Platinum I": 26,
  "Emerald IV": 30,
  "Emerald III": 35,
  "Emerald II": 40,
  "Emerald I": 45,
  "Diamond IV": 59,
  "Diamond III": 69,
  "Diamond II": 79,
  "Diamond I": 120,
};

function getTierFromAnyRank(rank) {
  return (rank || "").split(" ")[0];
}

function getLpBandModifierForDivision(lpText) {
  if (lpText === "0-20 LP") return 1.1;
  if (lpText === "21-40 LP") return 1;
  if (lpText === "41-60 LP") return 0.95;
  if (lpText === "61-80 LP" || lpText === "81-99 LP") return 0.9;
  return 1;
}

function getLpBandModifierForNetWins(lpText) {
  if (lpText === "0-20 LP") return 1;
  if (lpText === "21-40 LP") return 1;
  if (lpText === "41-60 LP") return 1.05;
  if (lpText === "61-80 LP" || lpText === "81-99 LP") return 1.1;
  return 1;
}

function calculateRankBoostPrice(currentRank, desiredRank, currentLP) {
  const currentIndex = rankOptions.indexOf(currentRank);
  const desiredIndex = rankOptions.indexOf(desiredRank);

  if (currentIndex === -1 || desiredIndex === -1 || desiredIndex <= currentIndex) {
    return 0;
  }

  let total = 0;

  for (let i = currentIndex; i < desiredIndex; i += 1) {
    const stepRank = rankOptions[i];
    const stepPrice = divisionStepPrices[stepRank] || 0;

    if (i === currentIndex) {
      total += stepPrice * getLpBandModifierForDivision(currentLP);
    } else {
      total += stepPrice;
    }
  }

  return total;
}

function getPlacementBasePrice(peakRank) {
  const tier = getTierFromAnyRank(peakRank);

  if (peakRank === "Unranked") return 24;
  if (tier === "Iron" || tier === "Bronze") return 15;
  if (tier === "Silver") return 21;
  if (tier === "Gold") return 25;
  if (tier === "Platinum") return 30;
  if (tier === "Diamond") return 45;
  if (tier === "Master") return 60;

  return 24;
}

function calculatePlacementBoostPrice(peakRank, placementGames) {
  const fullSetPrice = getPlacementBasePrice(peakRank);
  const safeGames = Math.max(1, Math.min(5, placementGames || 5));
  return (fullSetPrice / 5) * safeGames;
}

function getNetWinBasePrice(currentRank) {
  const tier = getTierFromAnyRank(currentRank);

  if (tier === "Silver") return 3;
  if (tier === "Gold") return 5;
  if (tier === "Platinum" || tier === "Emerald" || tier === "Diamond") return 6;
  if (tier === "Master") return 30;

  return 3;
}

function calculateWinBoostPrice(currentRank, currentLP, desiredWins) {
  const safeWins = Math.max(1, desiredWins || 1);
  const basePerWin = getNetWinBasePrice(currentRank);
  const modifier = getLpBandModifierForNetWins(currentLP);
  return basePerWin * modifier * safeWins;
}

function calculateProDuoPrice(currentRank, currentLP, numberOfGames) {
  const safeGames = Math.max(1, numberOfGames || 1);
  const winBoostEquivalent = calculateWinBoostPrice(currentRank, currentLP, 1);
  return winBoostEquivalent * 0.75 * safeGames;
}

function getBonusWinPriceByRank(currentRank) {
  const tier = getTierFromAnyRank(currentRank);

  if (tier === "Silver") return 3;
  if (tier === "Gold") return 5;
  if (tier === "Platinum" || tier === "Emerald" || tier === "Diamond") return 6;
  if (tier === "Master") return 30;

  return 0;
}

function getChampionPreferencePrice(basePrice, tier) {
  if (tier === "1") return basePrice * 0.1;
  if (tier === "2-3") return basePrice * 0.05;
  return 0;
}

export default OrderPage;