import { useEffect, useState } from "react";
import { cleanIconPixels } from "../utils/cleanIconPixels";

const iconCache = new Map();

function CleanIcon({ src, alt, className }) {
  const [processed, setProcessed] = useState(() => ({ source: src, value: iconCache.get(src) || "", ready: iconCache.has(src) }));
  const cleanSrc = processed.source === src ? processed.value : iconCache.get(src) || "";
  const isReady = processed.source === src ? processed.ready : iconCache.has(src);

  useEffect(() => {
    if (!src || iconCache.has(src)) return;

    let cancelled = false;

    const image = new Image();
    const sameOrigin = new URL(src, window.location.href).origin === window.location.origin;
    if (!sameOrigin) image.crossOrigin = "anonymous";

    const cacheBustedSrc = src.includes("?")
      ? `${src}&clean=v2`
      : `${src}?clean=v2`;

    image.src = sameOrigin ? src : cacheBustedSrc;

    image.onload = () => {
      if (cancelled) return;

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;

      ctx.drawImage(image, 0, 0);

      let imageData;

      try {
        imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      } catch (error) {
        console.warn("CleanIcon could not read image pixels:", src, error);

        iconCache.set(src, src);

        if (!cancelled) {
          setProcessed({ source: src, value: src, ready: true });
        }

        return;
      }

      const needsCleanedImage = cleanIconPixels(imageData);
      if (needsCleanedImage) ctx.putImageData(imageData, 0, 0);

      const processedSrc = needsCleanedImage ? canvas.toDataURL("image/png") : src;
      iconCache.set(src, processedSrc);

      if (!cancelled) {
        setProcessed({ source: src, value: processedSrc, ready: true });
      }
    };

    image.onerror = () => {
      if (cancelled) return;

      iconCache.set(src, src);
      setProcessed({ source: src, value: src, ready: true });
    };

    return () => {
      cancelled = true;
    };
  }, [src]);

  return (
    <img
      src={cleanSrc || undefined}
      alt={alt}
      className={`${className || ""} clean-icon ${isReady ? "clean-icon-ready" : ""}`}
    />
  );
}

export default CleanIcon;
