const finiteNumber = value => typeof value === 'number' && Number.isFinite(value);
const positiveNumber = value => finiteNumber(value) && value > 0;

function centeredAxis(preferredSize, availableSize, availableStart, windowSize, windowStart) {
  const limit = positiveNumber(availableSize) ? availableSize : positiveNumber(windowSize) ? windowSize : preferredSize;
  const size = Math.max(1, Math.floor(Math.min(preferredSize, limit)));
  let position;
  if (finiteNumber(availableStart) && positiveNumber(availableSize)) {
    // Available display coordinates can be negative on monitors left of or above the primary display.
    const end = availableStart + availableSize - size;
    position = Math.max(availableStart, Math.min(end, Math.round(availableStart + (availableSize - size) / 2)));
  } else {
    const start = finiteNumber(windowStart) ? windowStart : 0;
    const span = positiveNumber(windowSize) ? windowSize : size;
    position = Math.round(start + (span - size) / 2);
  }
  return { size, position: finiteNumber(position) ? position : 0 };
}

export function socialAuthPopupFeatures(browserWindow = window) {
  const browser = browserWindow || {};
  const screen = browser.screen || {};
  const horizontal = centeredAxis(520, screen.availWidth, screen.availLeft,
    positiveNumber(browser.outerWidth) ? browser.outerWidth : browser.innerWidth,
    finiteNumber(browser.screenX) ? browser.screenX : browser.screenLeft);
  const vertical = centeredAxis(720, screen.availHeight, screen.availTop,
    positiveNumber(browser.outerHeight) ? browser.outerHeight : browser.innerHeight,
    finiteNumber(browser.screenY) ? browser.screenY : browser.screenTop);
  return `popup,width=${horizontal.size},height=${vertical.size},left=${horizontal.position},top=${vertical.position}`;
}
