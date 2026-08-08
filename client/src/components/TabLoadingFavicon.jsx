import { useEffect, useRef, useState } from "react";

export default function TabLoadingFavicon() {
  const [loading, setLoading] = useState(false);
  const pendingRequests = useRef(0);
  const loadingDelay = useRef(null);

  useEffect(() => {
    const originalFetch = globalThis.fetch;

    const wrappedFetch = async (...args) => {
      pendingRequests.current += 1;

      if (pendingRequests.current === 1) {
        loadingDelay.current = window.setTimeout(() => {
          setLoading(true);
        }, 120);
      }

      try {
        return await originalFetch(...args);
      } finally {
        pendingRequests.current = Math.max(0, pendingRequests.current - 1);

        if (pendingRequests.current === 0) {
          if (loadingDelay.current) {
            window.clearTimeout(loadingDelay.current);
            loadingDelay.current = null;
          }

          setLoading(false);
        }
      }
    };

    globalThis.fetch = wrappedFetch;

    return () => {
      globalThis.fetch = originalFetch;

      if (loadingDelay.current) {
        window.clearTimeout(loadingDelay.current);
      }
    };
  }, []);

  useEffect(() => {
    const favicon =
      document.querySelector('link[rel="icon"]') ||
      document.querySelector('link[rel="shortcut icon"]');

    if (!favicon) return;

    const originalHref = favicon.getAttribute("href");
    const originalType = favicon.getAttribute("type");

    if (!loading) {
      if (originalHref) {
        favicon.setAttribute("href", originalHref);
      }

      return;
    }

    let rotation = 0;

    const renderSpinner = () => {
      const svg = `
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="32"
          height="32"
          viewBox="0 0 32 32"
        >
          <circle
            cx="16"
            cy="16"
            r="11"
            fill="none"
            stroke="rgba(255,255,255,0.25)"
            stroke-width="3"
          />

          <circle
            cx="16"
            cy="16"
            r="11"
            fill="none"
            stroke="white"
            stroke-width="3"
            stroke-linecap="round"
            stroke-dasharray="18 52"
            transform="rotate(${rotation} 16 16)"
          />
        </svg>
      `;

      favicon.setAttribute(
        "href",
        `data:image/svg+xml,${encodeURIComponent(svg)}`
      );
      favicon.setAttribute("type", "image/svg+xml");

      rotation = (rotation + 30) % 360;
    };

    renderSpinner();
    const interval = window.setInterval(renderSpinner, 70);

    return () => {
      window.clearInterval(interval);

      if (originalHref) {
        favicon.setAttribute("href", originalHref);
      }

      if (originalType) {
        favicon.setAttribute("type", originalType);
      }
    };
  }, [loading]);

  return null;
}
