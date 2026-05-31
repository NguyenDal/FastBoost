import { useEffect, useState } from "react";

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
  const [cleanSrc, setCleanSrc] = useState(src);

  useEffect(() => {
    if (!src) return;

    const image = new Image();
    image.crossOrigin = "anonymous";

    const cacheBustedSrc = src.includes("?")
      ? `${src}&clean=${Date.now()}`
      : `${src}?clean=${Date.now()}`;

    image.src = cacheBustedSrc;

    image.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;

      ctx.drawImage(image, 0, 0);

      let imageData;

      try {
        imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      } catch (error) {
        console.warn("CleanIcon failed because S3 CORS is not allowing canvas access:", src);
        setCleanSrc(src);
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
      setCleanSrc(canvas.toDataURL("image/png"));
    };

    image.onerror = () => {
      setCleanSrc(src);
    };
  }, [src]);

  return <img src={cleanSrc} alt={alt} className={className} />;
}

export default CleanIcon;