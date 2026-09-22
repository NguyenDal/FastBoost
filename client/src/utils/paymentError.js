// Only approved customer-facing copy may leave the payment boundary.
export function paymentErrorMessage(error) {
    const messages = {
        email_required: "Please enter a valid email address so we can send your payment confirmation.",
        incomplete_number: "Please enter your full card number.",
        incorrect_number: "Please check your card number and try again.",
        invalid_number: "Please check your card number and try again.",
        incomplete_expiry: "Please enter your card’s expiration date.",
        invalid_expiry_month: "Please check your card’s expiration date.",
        invalid_expiry_year: "Please check your card’s expiration date.",
        expired_card: "Your card has expired. Please use another card.",
        incomplete_cvc: "Please enter your card’s security code.",
        incorrect_cvc: "Please check your card’s security code.",
        invalid_cvc: "Please check your card’s security code.",
        card_declined: "Your card was declined. Please use another card or contact your bank.",
        billing_required: "Please enter the cardholder name and select a country.",
    };
    return messages[error?.code] || "We couldn’t complete your payment. Please review your details and try again. If this keeps happening, contact support.";
}
