import Navbar from "../components/Navbar";
import AdMeasurementConsent from "../components/AdMeasurementConsent";
import { googleAdsMeasurement } from "../utils/googleAdsMeasurement";
import "../styles/LegalDocument.css";

export default function LegalDocumentPage({ privacy = false }) {
  const title = privacy ? "Privacy Policy" : "Terms and Conditions";
  const documentPath = privacy ? "privacy-policy" : "terms-and-conditions";
  return <div className="legal-document-page">
    <Navbar />
    {privacy && googleAdsMeasurement.enabled && <details className="legal-ad-preferences">
      <summary>Ad measurement preferences</summary>
      <AdMeasurementConsent />
    </details>}
    <iframe key={documentPath} title={title} src={`/legal/${documentPath}.html`} className="legal-document-frame" />
  </div>;
}
