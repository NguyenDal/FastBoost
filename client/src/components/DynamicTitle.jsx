import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export default function DynamicTitle() {
  const location = useLocation();

  useEffect(() => {
    const path = location.pathname;

    let title = "FastBoost";

    if (path === "/") {
      title = "FastBoost";
    } else if (path.startsWith("/r/")) {
      title = "Create Account | FastBoost";
    } else if (path === "/login") {
      title = "Sign In | FastBoost";
    } else if (path === "/register") {
      title = "Create Account | FastBoost";
    } else if (path === "/reset-password") {
      title = "Reset Password | FastBoost";
    } else if (path === "/contact") {
      title = "Contact | FastBoost";
    } else if (path.startsWith("/order/")) {
      title = "Order | FastBoost";
    } else if (path.startsWith("/payment/success/")) {
      title = "Payment Successful | FastBoost";
    } else if (path.startsWith("/payment/cancelled/")) {
      title = "Payment Cancelled | FastBoost";
    } else if (path.startsWith("/match/")) {
      title = "Order Chat | FastBoost";
    } else if (path === "/admin/management") {
      title = "Management Utilities | FastBoost";
    } else if (path === "/admin/orders") {
      title = "Order Management | FastBoost";
    } else if (path.startsWith("/admin/orders/")) {
      title = "Order Details | FastBoost";
    } else if (path === "/admin/accounts") {
      title = "Account Management | FastBoost";
    } else if (path === "/admin/prices") {
      title = "Price Management | FastBoost";
    } else if (path === "/provider/orders") {
      title = "Assigned Orders | FastBoost";
    } else if (path.startsWith("/provider/orders/")) {
      title = "Assigned Order | FastBoost";
    } else if (path === "/account/dashboard") {
      title = "Dashboard | FastBoost";
    } else if (path === "/account/orders") {
      title = "My Orders | FastBoost";
    } else if (path === "/account/change-password") {
      title = "Change Password | FastBoost";
    } else if (path === "/account/loyalty") {
      title = "Loyalty Rewards | FastBoost";
    } else if (path === "/account/settings") {
      title = "Profile | FastBoost";
    }

    document.title = title;
  }, [location.pathname]);

  return null;
}