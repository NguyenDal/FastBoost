export default function LegalDocumentPage({ provider = false }) {
  const title = provider ? "Provider Agreement" : "Terms and Conditions";
  return <iframe title={title} src={`/legal/${provider ? "provider-agreement" : "terms-and-conditions"}.html`}
    style={{ display: "block", width: "100%", height: "100dvh", border: 0 }} />;
}
