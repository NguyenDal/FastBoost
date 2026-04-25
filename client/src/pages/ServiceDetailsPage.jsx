import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import "../styles/AuthPages.css";
import "../styles/ServiceDetailsPage.css";

function ServiceDetailsPage() {
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
        setError("Could not load service details");
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
            <p className="section-label">Service Details</p>
            <h1>{service.title}</h1>
            <p className="section-description">
              {service.description || "No description available."}
            </p>

            <div className="hover-service-actions details-page-actions">
              <Link to={`/order/${service.id}`} className="primary-btn details-link-btn">
                Order Now
              </Link>
              <Link to="/" className="secondary-btn details-link-btn">
                Back
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ServiceDetailsPage;