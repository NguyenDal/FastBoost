import Navbar from "../components/Navbar";
import "../styles/LegalDocument.css";

export default function LegalDocumentPage({ provider = false, privacy = false }) {
  const title = provider ? "Provider Agreement" : privacy ? "Privacy Policy" : "Terms and Conditions";
  if (provider) return <iframe title={title} src="/legal/provider-agreement.html"
    style={{ display: "block", width: "100%", height: "100dvh", border: 0 }} />;
  return <div className="legal-document-page">
    <Navbar />
    <iframe title={title} src={privacy ? "/legal/privacy-policy.html" : "/legal/terms-and-conditions.html"} className="legal-document-frame" />
  </div>;
}
