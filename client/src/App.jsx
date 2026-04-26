import { Routes, Route } from "react-router-dom";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import OrderPage from "./pages/OrderPage";
import ServiceDetailsPage from "./pages/ServiceDetailsPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import MatchPage from "./pages/MatchPage";
import AdminOrdersPage from "./pages/AdminOrdersPage";
import AdminOrderDetailsPage from "./pages/AdminOrderDetailsPage";

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/order/:serviceId" element={<OrderPage />} />
      <Route path="/services/:serviceId" element={<ServiceDetailsPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/match/:orderId" element={<MatchPage />} />
      <Route path="/admin/orders" element={<AdminOrdersPage />} />
      <Route path="/admin/orders/:id" element={<AdminOrderDetailsPage />} />
    </Routes>
  );
}

export default App;