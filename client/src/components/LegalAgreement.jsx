export default function LegalAgreement({ action }) {
  return <>{action ? `By ${action}, you agree to our ` : "I agree to the "}<a href="/privacy-policy" target="_blank" rel="noreferrer">Privacy Policy</a> and <a href="/terms-and-conditions" target="_blank" rel="noreferrer">Terms and Conditions</a>.</>;
}
