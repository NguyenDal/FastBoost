import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import "../App.css";

function OrderPage() {
  const { serviceId } = useParams();
  const [service, setService] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
      } catch (error) {
        setError("Could not load this service");
      } finally {
        setLoading(false);
      }
    };

    fetchService();
  }, [serviceId]);

  return (
    <div className="auth-page">
      <div className="auth-card">
        {loading && <p className="info-message">Loading service...</p>}
        {error && <p className="error-message">{error}</p>}

        {!loading && !error && service && (
          <>
            <p className="section-label">Order Flow</p>
            <h1>{service.title}</h1>
            <p className="section-description">
              {service.description || "No description available."}
            </p>

            <textarea
              className="auth-input auth-textarea"
              placeholder="Describe what you want for this service..."
              rows="6"
            />

            <button className="primary-btn auth-submit-btn">
              Submit Request
            </button>

            <p className="auth-switch-text">
              <Link to="/">Back to homepage</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default OrderPage;