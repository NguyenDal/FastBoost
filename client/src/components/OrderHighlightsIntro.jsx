export function FilmIcon({ size = 28 }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="5" y="7" width="22" height="18" rx="3" stroke="currentColor" strokeWidth="1.7"/><path d="M10 7v18M22 7v18M5 13h5m-5 6h5m12-6h5m-5 6h5" stroke="currentColor" strokeWidth="1.7"/><path d="m14 12 5 4-5 4v-8Z" fill="currentColor" /></svg>;
}

export default function OrderHighlightsIntro() {
  return <header className="highlight-intro">
    <div>
      <p className="highlight-eyebrow"><span className="highlight-eyebrow-dot" /> ORDER HIGHLIGHTS</p>
      <h2 id="order-highlights-title">The moments worth keeping.</h2>
      <p>Watch the best moments from this order, uploaded by your FastBoost team.</p>
    </div>
    <div className="highlight-intro-mark" aria-hidden="true"><FilmIcon size={35} /><span>PLAY / WATCH / RELIVE</span></div>
  </header>;
}
