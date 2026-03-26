import { useEffect, useState } from "react";
import { getServices } from "../api/services";

export default function ServicesPage() {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchServices = async () => {
      try {
        const data = await getServices();
        setServices(data.services || []);
      } catch (err) {
        setError(err.message || "Something went wrong");
      } finally {
        setLoading(false);
      }
    };

    fetchServices();
  }, []);

  if (loading) {
    return <div style={{ padding: "2rem" }}>Loading services...</div>;
  }

  if (error) {
    return <div style={{ padding: "2rem", color: "red" }}>{error}</div>;
  }

  return (
    <div style={{ padding: "2rem" }}>
      <h1>Gaming Services</h1>
      <p>Choose the service that fits your goal.</p>

      {services.length === 0 ? (
        <p>No services found.</p>
      ) : (
        <div style={{ display: "grid", gap: "1rem", marginTop: "1.5rem" }}>
          {services.map((service) => (
            <div
              key={service.id}
              style={{
                border: "1px solid #ccc",
                borderRadius: "12px",
                padding: "1rem",
                background: "#fff",
              }}
            >
              <h2>{service.title}</h2>
              <p>{service.description || "No description available."}</p>
              <button style={{ marginTop: "1rem" }}>Order Now</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}