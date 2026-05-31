import { useEffect, useState } from "react";

const iconCache = new Map();

function isCheckerboardBackgroundPixel(r, g, b, a) {
  if (a === 0) return true;

  const isLightGrey =
    r >= 215 &&
    g >= 215 &&
    b >= 215 &&
    Math.abs(r - g) <= 12 &&
    Math.abs(g - b) <= 12;

  const isDarkChecker =
    r <= 55 &&
    g <= 55 &&
    b <= 55 &&
    Math.abs(r - g) <= 14 &&
    Math.abs(g - b) <= 14;

  return isLightGrey || isDarkChecker;
}

function CleanIcon({ src, alt, className }) {
  const [cleanSrc, setCleanSrc] = useState(() => iconCache.get(src) || "");
  const [isReady, setIsReady] = useState(() => iconCache.has(src));

  useEffect(() => {
    if (!src) return;

    if (iconCache.has(src)) {
      setCleanSrc(iconCache.get(src));
      setIsReady(true);
      return;
    }

    let cancelled = false;

    setIsReady(false);
    setCleanSrc("");

    const image = new Image();
    image.crossOrigin = "anonymous";

    const cacheBustedSrc = src.includes("?")
      ? `${src}&clean=v2`
      : `${src}?clean=v2`;

    image.src = cacheBustedSrc;

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
        console.warn("CleanIcon skipped because S3 CORS blocked canvas access:", src);

        iconCache.set(src, src);

        if (!cancelled) {
          setCleanSrc(src);
          setIsReady(true);
        }

        return;
      }

      const { data, width, height } = imageData;

      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const index = (y * width + x) * 4;

          const r = data[index];
          const g = data[index + 1];
          const b = data[index + 2];
          const a = data[index + 3];

          if (isCheckerboardBackgroundPixel(r, g, b, a)) {
            data[index + 3] = 0;
          }
        }
      }

      ctx.putImageData(imageData, 0, 0);

      const processedSrc = canvas.toDataURL("image/png");
      iconCache.set(src, processedSrc);

      if (!cancelled) {
        setCleanSrc(processedSrc);
        setIsReady(true);
      }
    };

    image.onerror = () => {
      if (cancelled) return;

      iconCache.set(src, src);
      setCleanSrc(src);
      setIsReady(true);
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