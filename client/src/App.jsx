import { useEffect, useState } from "react";
import "./App.css";

function App() {
  const [healthMessage, setHealthMessage] = useState("Checking backend...");
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const response = await fetch("http://localhost:5000/api/health");
        const data = await response.json();
        setHealthMessage(data.message);
      } catch (err) {
        setError("Could not connect to backend");
      }
    };

    fetchHealth();
  }, []);

  return (
    <div style={{ padding: "2rem", fontFamily: "Arial, sans-serif" }}>
      <h1>Gaming Services Platform</h1>
      <p>Beginner full-stack project</p>

      <h2>Backend Status</h2>
      {error ? <p>{error}</p> : <p>{healthMessage}</p>}
    </div>
  );
}

export default App;