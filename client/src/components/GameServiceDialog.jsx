import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import CleanIcon from "./CleanIcon";
import "../styles/GameServiceDialog.css";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const SERVICE_SUMMARIES = {
  'Rank Boost': 'Climb from your current rank to your next goal.',
  'Placement Boost': 'Get a stronger start in your placement matches.',
  'Win Boost': 'Choose the wins you need for your next milestone.',
  'Pro Duo': 'Play alongside a skilled teammate on your own account.',
  'TFT Rank Boost': 'Climb from your current TFT rank to your target.',
  'TFT Win Boost': 'Get the TFT wins you need for your next goal.',
  'TFT Placement Boost': 'Start your TFT season with stronger placements.',
};

function serviceTone(title = "") {
  const name = title.toLowerCase();
  if (name.includes("placement")) return "placement";
  if (name.includes("win")) return "win";
  if (name.includes("duo")) return "duo";
  return "rank";
}

function originTransform(sourceElement, panel) {
  const panelRect = panel.getBoundingClientRect();
  const source = sourceElement?.isConnected ? sourceElement.getBoundingClientRect() : null;
  const sourceIsVisible = source && source.width > 0 && source.height > 0
    && source.right > 0 && source.bottom > 0
    && source.left < window.innerWidth && source.top < window.innerHeight;

  if (!sourceIsVisible || !panelRect.width || !panelRect.height) {
    return "translate3d(0, 18px, 0) scale(.94)";
  }

  const dx = source.left + source.width / 2 - (panelRect.left + panelRect.width / 2);
  const dy = source.top + source.height / 2 - (panelRect.top + panelRect.height / 2);
  const sx = Math.min(1.15, Math.max(.12, source.width / panelRect.width));
  const sy = Math.min(1.15, Math.max(.12, source.height / panelRect.height));
  return `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})`;
}

function GameServiceDialog({
  game,
  open,
  services = [],
  loading = false,
  error = "",
  imageMap = {},
  fallbackImages = [],
  onChoose,
  onClose,
  onExited,
  sourceElement,
}) {
  const overlayRef = useRef(null);
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  const animationsRef = useRef([]);
  const transitionRef = useRef(0);
  const latestRef = useRef({ onClose, onExited, sourceElement });

  useLayoutEffect(() => {
    latestRef.current = { onClose, onExited, sourceElement };
  }, [onClose, onExited, sourceElement]);

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const previousFocus = document.activeElement;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyPadding = document.body.style.paddingRight;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const scrollbarGap = window.innerWidth - document.documentElement.clientWidth;
    const siblings = Array.from(document.body.children)
      .filter(element => element !== overlay)
      .map(element => ({ element, inert: element.inert }));

    siblings.forEach(({ element }) => { element.inert = true; });
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    if (scrollbarGap > 0) {
      const padding = Number.parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
      document.body.style.paddingRight = `${padding + scrollbarGap}px`;
    }

    const focusFrame = window.requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }));
    const onKeyDown = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        latestRef.current.onClose?.();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(panelRef.current?.querySelectorAll(FOCUSABLE) || [])
        .filter(element => element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panelRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panelRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      transitionRef.current += 1;
      animationsRef.current.forEach(animation => animation.cancel());
      animationsRef.current = [];
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      siblings.forEach(({ element, inert }) => { element.inert = inert; });
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.paddingRight = previousBodyPadding;
      document.documentElement.style.overflow = previousHtmlOverflow;
      const source = latestRef.current.sourceElement;
      const sourceFocusTarget = source?.isConnected
        ? source.matches?.(FOCUSABLE) ? source : source.querySelector?.(FOCUSABLE)
        : null;
      const restoreTo = sourceFocusTarget || (previousFocus?.isConnected ? previousFocus : null);
      restoreTo?.focus?.({ preventScroll: true });
    };
  }, []);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const backdrop = overlayRef.current?.querySelector(".game-service-dialog-backdrop");
    if (!panel || !backdrop) return;

    const oldAnimations = animationsRef.current;
    const currentTransform = oldAnimations.length ? window.getComputedStyle(panel).transform : null;
    const currentOpacity = oldAnimations.length ? window.getComputedStyle(panel).opacity : null;
    const currentBackdropOpacity = oldAnimations.length ? window.getComputedStyle(backdrop).opacity : null;
    oldAnimations.forEach(animation => animation.cancel());
    animationsRef.current = [];
    const transitionId = ++transitionRef.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion || typeof panel.animate !== "function") {
      if (!open) {
        queueMicrotask(() => {
          if (transitionRef.current === transitionId) latestRef.current.onExited?.();
        });
      }
      return;
    }

    const origin = originTransform(latestRef.current.sourceElement, panel);
    const duration = open ? 500 : 380;
    const ease = open ? "cubic-bezier(.16, 1, .3, 1)" : "cubic-bezier(.65, 0, .85, .25)";
    const panelFrames = open
      ? [
          { transform: currentTransform || origin, opacity: currentOpacity || 0.35 },
          { transform: "none", opacity: 1 },
        ]
      : [
          { transform: currentTransform || "none", opacity: currentOpacity || 1 },
          { transform: origin, opacity: 0.35 },
        ];
    const panelAnimation = panel.animate(panelFrames, { duration, easing: ease, fill: "both" });
    const backdropAnimation = backdrop.animate([
      { opacity: currentBackdropOpacity || (open ? 0 : 1) },
      { opacity: open ? 1 : 0 },
    ], { duration: open ? 330 : 300, easing: "ease", fill: "both" });
    animationsRef.current = [panelAnimation, backdropAnimation];

    Promise.all([panelAnimation.finished, backdropAnimation.finished]).then(() => {
      if (transitionRef.current !== transitionId) return;
      animationsRef.current = [];
      if (open) {
        panelAnimation.cancel();
        backdropAnimation.cancel();
      } else {
        latestRef.current.onExited?.();
      }
    }).catch(() => {});
  }, [open]);

  const close = () => latestRef.current.onClose?.();
  const title = game?.title || "Game services";
  const cards = Array.isArray(services) ? services : [];
  const skeletonCount = game?.key === "tft" ? 3 : 4;

  return createPortal(
    <div className="game-service-dialog-overlay" ref={overlayRef} data-closing={!open || undefined}>
      <div className="game-service-dialog-backdrop" aria-hidden="true" onMouseDown={event => {
        if (event.target === event.currentTarget) close();
      }} />
      <section
        className={`game-service-dialog-panel game-service-dialog-panel-${game?.key === "tft" ? "tft" : "lol"}`}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-service-dialog-title"
        aria-describedby="game-service-dialog-subtitle"
        tabIndex={-1}
      >
        <header className="game-service-dialog-hero">
          {game?.image && <img className="game-service-dialog-hero-image" src={game.image} alt="" />}
          <div className="game-service-dialog-hero-shade" />
          <div className="game-service-dialog-topbar">
            <button type="button" className="game-service-dialog-close" ref={closeRef} onClick={close} aria-label="Close service selection">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </button>
          </div>
          <div className="game-service-dialog-heading">
            <h2 id="game-service-dialog-title">{title}</h2>
            <p id="game-service-dialog-subtitle">Choose your service</p>
          </div>
        </header>

        <div className="game-service-dialog-content">
          {loading && <div className="game-service-dialog-grid" aria-label="Loading services" aria-busy="true">
            {Array.from({ length: skeletonCount }, (_, index) => <div className="game-service-dialog-skeleton" key={index} aria-hidden="true"><span /><i /><b /><em /></div>)}
          </div>}
          {!loading && error && <div className="game-service-dialog-message" role="alert"><strong>Services are unavailable right now.</strong><span>{error}</span></div>}
          {!loading && !error && cards.length === 0 && <div className="game-service-dialog-message"><strong>No services are available yet.</strong><span>Check back soon.</span></div>}
          {!loading && !error && cards.length > 0 && <div className={`game-service-dialog-grid${game?.key === "tft" ? " game-service-dialog-grid-tft" : ""}`}>
            {cards.map((service, index) => {
              const tone = serviceTone(service.title);
              const image = imageMap?.[service.title] || fallbackImages[index % fallbackImages.length] || "";
              const unavailable = service.active === false;
              return <article className={`game-service-dialog-card game-service-dialog-card-${tone}${unavailable ? " is-unavailable" : ""}`} key={service.id || `${service.title}-${index}`}>
                <div className="game-service-dialog-art" aria-hidden="true">
                  {image && <CleanIcon src={image} alt="" className="game-service-dialog-icon" />}
                </div>
                <div className="game-service-dialog-card-copy">
                  <h3>{service.title}</h3>
                  <p>{SERVICE_SUMMARIES[service.title] || service.description || "Find the right boost for your game."}</p>
                  <button type="button" disabled={unavailable} onClick={() => onChoose?.(service)}>
                    {unavailable ? "Currently unavailable" : "Buy now"}
                    {!unavailable && <span aria-hidden="true">↗</span>}
                  </button>
                </div>
              </article>;
            })}
          </div>}
        </div>
      </section>
    </div>,
    document.body,
  );
}

export default GameServiceDialog;
