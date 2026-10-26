import test from "node:test";
import assert from "node:assert/strict";
import { authReturnPath } from "../src/utils/authReturnPath.js";

test("login return preserves order links including the rating fragment and query", () => {
  for (const value of [
    "/match/cmn0hmwib000168ui69lsqvry",
    "/match/cmn0hmwib000168ui69lsqvry#order-rating",
    "/match/order-id_123?source=completion-email#order-rating",
  ]) assert.equal(authReturnPath(value), value);
});

test("login return keeps existing provider agreement and contract destinations", () => {
  for (const value of [
    "/provider-agreement", "/provider/workspace", "/provider/portal", "/provider/contracts/contract-123",
    "/provider/contracts/contract-123?source=email#agreement", "/provider/contracts/contract-123/sign",
  ]) assert.equal(authReturnPath(value), value);
});

test("signing in resumes the same interrupted checkout or payment verification", () => {
  for (const value of [
    "/checkout/order-123", "/checkout/order-123?gold=100",
    "/payment/success/service-123?session_id=cs_test_existing",
    "/payment/cancelled/service-123?orderId=order-123",
  ]) assert.equal(authReturnPath(value), value);
  for (const value of ["/checkout/../admin", "/checkout/%2e%2e", "/payment/success/../../admin", "/payment/unknown/service-123"])
    assert.equal(authReturnPath(value), null);
});

test("login return rejects external, malformed, traversing and unrelated destinations", () => {
  for (const value of [
    undefined, null, {}, 1, "", "https://example.com/match/order", "//example.com/match/order",
    "\\\\example.com", "/\\example.com/match/order", "javascript:alert(1)",
    " /match/order", "/match/order\n", "/match/order\u0000", "/match/order?x=bad\r\n",
    "/match/../admin", "/match/%2e%2e", "/match/order/extra", "/match/order%2Fextra",
    "/provider/contracts/../workspace", "/provider/contracts/", "/provider/contracts/contract-123/sign/other", "/match/", "/admin/orders",
    "/account/settings", "/", "/match/order?" + "x".repeat(2048),
  ]) assert.equal(authReturnPath(value), null, String(value));
});
