import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import "../App.css";

function OrderPage() {
  const navigate = useNavigate();
  const { serviceId } = useParams();

  const [service, setService] = useState(null);
  const [selectedBoostType, setSelectedBoostType] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [formData, setFormData] = useState({
    currentRank: "Silver I",
    desiredRank: "Gold IV",
    currentLP: "0-20 LP",
    peakRank: "Unranked",
    desiredWins: "5",
    placementGames: "5",
    preferredRole: "Mid",
    numberOfGames: "3",
    region: "North America",
    queueType: "Solo/Duo",
    playMode: "Solo",
    notes: "",
    priorityOrder: false,
    duoWithBooster: false,
    liveStream: false,
    appearOffline: false,
    championsRoles: false,
    bonusWin: false,
    soloOnly: false,
    undercoverWinrate: false,
    moderateKDA: false,
    highMMRDuo: false,
  });

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
        setError("Could not load this service");
      } finally {
        setLoading(false);
      }
    };

    fetchService();
  }, [serviceId]);

  const serviceType = selectedBoostType || service?.title || "";
  const basePrice = useMemo(() => {
    if (serviceType === "Rank Boost") {
      const rankSteps = getRankStepDifference(
        formData.currentRank,
        formData.desiredRank
      );
      return 12 + rankSteps * 6;
    }

    if (serviceType === "Placement Boost") {
      return 10 + Number(formData.placementGames) * 2;
    }

    if (serviceType === "Win Boost") {
      return 8 + Number(formData.desiredWins) * 2.5;
    }

    if (serviceType === "Pro Duo") {
      return 7 + Number(formData.numberOfGames) * 3;
    }

    return 10;
  }, [
    serviceType,
    formData.currentRank,
    formData.desiredRank,
    formData.placementGames,
    formData.desiredWins,
    formData.numberOfGames,
  ]);

  const addonPrice = useMemo(() => {
    let total = 0;
    if (formData.priorityOrder) total += 5;
    if (formData.duoWithBooster) total += 6;
    if (formData.liveStream) total += 3;
    if (formData.championsRoles) total += 2;
    return total;
  }, [
    formData.priorityOrder,
    formData.duoWithBooster,
    formData.liveStream,
    formData.championsRoles,
  ]);

  const totalPrice = (basePrice + addonPrice).toFixed(2);

  const handleInputChange = (event) => {
    const { name, value, type, checked } = event.target;

    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();

    const demoOrder = {
      serviceId: service.id,
      serviceTitle: serviceType,
      serviceDescription: service.description || "",
      totalPrice,
      formData,
      createdAt: new Date().toISOString(),
    };

    localStorage.setItem("demoOrder", JSON.stringify(demoOrder));
    navigate(`/match/${service.id}`);
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

  if (error || !service) {
    return (
      <div className="order-page-shell">
        <div className="order-page-container">
          <p className="error-message">{error || "Service not found."}</p>
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
            <p className="section-label">Checkout</p>
            <h1 className="order-page-title compact-title">Secure order summary</h1>
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
                    <label>Preferred Role</label>
                    <select
                      name="preferredRole"
                      value={formData.preferredRole}
                      onChange={handleInputChange}
                    >
                      <option>Top</option>
                      <option>Jungle</option>
                      <option>Mid</option>
                      <option>ADC</option>
                      <option>Support</option>
                    </select>
                  </div>

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
            <p className="section-label">Order Summary</p>
            <h2>{serviceType}</h2>

            {serviceType === "Rank Boost" && (
              <div className="order-rank-strip">
                <div className="order-rank-box">
                  <span className="order-rank-label">Current</span>
                  <strong>{formData.currentRank} {formData.currentLP}</strong>
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
                    duoWithBooster: true,
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
                        <span className="order-addon-badge">+20%</span>
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
                        <span className="order-addon-badge">+8.2 $</span>
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
                        <span className="order-addon-badge">+35%</span>
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
                        <span className="order-addon-badge recommended">RECOMMENDED</span>
                      </div>
                      <span className="order-addon-switch">
                        <input
                          type="checkbox"
                          name="championsRoles"
                          checked={formData.championsRoles}
                          onChange={handleInputChange}
                        />
                        <span className="order-addon-slider" />
                      </span>
                    </label>

                    <label className="order-addon-row">
                      <div className="order-addon-copy">
                        <span className="order-addon-name">Undercover Winrate</span>
                        <span className="order-addon-badge">+40%</span>
                      </div>
                      <span className="order-addon-switch">
                        <input
                          type="checkbox"
                          name="undercoverWinrate"
                          checked={formData.undercoverWinrate || false}
                          onChange={handleInputChange}
                        />
                        <span className="order-addon-slider" />
                      </span>
                    </label>

                    <label className="order-addon-row">
                      <div className="order-addon-copy">
                        <span className="order-addon-name">Moderate KDA</span>
                        <span className="order-addon-badge">+30%</span>
                      </div>
                      <span className="order-addon-switch">
                        <input
                          type="checkbox"
                          name="moderateKDA"
                          checked={formData.moderateKDA || false}
                          onChange={handleInputChange}
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
                        <span className="order-addon-badge">+30%</span>
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
                        <span className="order-addon-badge">+8.2 $</span>
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

                    <label className="order-addon-row">
                      <div className="order-addon-copy">
                        <span className="order-addon-name">Undercover Winrate</span>
                        <span className="order-addon-badge">+40%</span>
                      </div>
                      <span className="order-addon-switch">
                        <input
                          type="checkbox"
                          name="undercoverWinrate"
                          checked={formData.undercoverWinrate || false}
                          onChange={handleInputChange}
                        />
                        <span className="order-addon-slider" />
                      </span>
                    </label>

                    <label className="order-addon-row">
                      <div className="order-addon-copy">
                        <span className="order-addon-name">Moderate KDA</span>
                        <span className="order-addon-badge">+30%</span>
                      </div>
                      <span className="order-addon-switch">
                        <input
                          type="checkbox"
                          name="moderateKDA"
                          checked={formData.moderateKDA || false}
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
              <button type="button" className="summary-speed-btn active">
                Standard
              </button>
              <button type="button" className="summary-speed-btn">
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

              {serviceType === "Rank Boost" && (
                <div className="order-summary-row">
                  <span>Path</span>
                  <strong>
                    {formData.currentRank} → {formData.desiredRank}
                  </strong>
                </div>
              )}

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

            <div className="order-summary-total-inline">
              <div className="order-summary-price-lines">
                <div className="order-summary-row">
                  <span>Base Price</span>
                  <strong>${basePrice.toFixed(2)}</strong>
                </div>

                <div className="order-summary-row">
                  <span>Add-ons</span>
                  <strong>${addonPrice.toFixed(2)}</strong>
                </div>
              </div>

              <div className="order-summary-total-inline-main">
                <span>Total Price</span>
                <strong>${totalPrice}</strong>
              </div>
            </div>

            <button type="submit" className="primary-btn order-submit-btn">
              Continue
            </button>
            
          </aside>
        </form>
      </div>
    </div>
  );
}

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

export default OrderPage;