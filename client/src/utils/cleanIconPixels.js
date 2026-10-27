function isCheckerboardPixel(r, g, b) {
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

// Clean only checkerboard connected to the image edge. The same gray shades
// inside an icon can be real artwork (for example, a metal shield highlight).
export function cleanIconPixels({ data, width, height }) {
  const pixelCount = width * height;

  // Genuine transparent images already have the cutout we need. Running the
  // gray-key filter on them would erase gray details from the artwork.
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (data[pixel * 4 + 3] < 255) return false;
  }

  const visited = new Uint8Array(pixelCount);
  const queue = new Uint32Array(pixelCount);
  let head = 0;
  let tail = 0;

  const visit = (pixel) => {
    if (visited[pixel]) return;
    visited[pixel] = 1;

    const offset = pixel * 4;
    if (!isCheckerboardPixel(data[offset], data[offset + 1], data[offset + 2])) return;

    data[offset + 3] = 0;
    queue[tail] = pixel;
    tail += 1;
  };

  for (let x = 0; x < width; x += 1) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    visit(y * width);
    visit(y * width + width - 1);
  }

  while (head < tail) {
    const pixel = queue[head];
    head += 1;
    const x = pixel % width;
    if (x > 0) visit(pixel - 1);
    if (x + 1 < width) visit(pixel + 1);
    if (pixel >= width) visit(pixel - width);
    if (pixel + width < pixelCount) visit(pixel + width);
  }

  return tail > 0;
}
