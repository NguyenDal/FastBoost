import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import "./styles/Global.css";
import "./styles/Shared.css";
import "./styles/Navbar.css";
import "./styles/Auth.css";
import "./styles/Layout.css";
import "./styles/ContactPage.css";
import "./styles/Skeleton.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);