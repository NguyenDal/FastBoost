import assert from "node:assert/strict";
import test from "node:test";
import { cleanIconPixels } from "./cleanIconPixels.js";

function image(width, height, color) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    data.set(color, pixel * 4);
  }
  return { data, width, height };
}

function setPixel(imageData, x, y, color) {
  imageData.data.set(color, (y * imageData.width + x) * 4);
}

function alphaAt(imageData, x, y) {
  return imageData.data[(y * imageData.width + x) * 4 + 3];
}

test("cleans edge checkerboard without cutting holes in enclosed gray artwork", () => {
  const imageData = image(5, 5, [240, 240, 240, 255]);

  for (let y = 1; y <= 3; y += 1) {
    for (let x = 1; x <= 3; x += 1) {
      setPixel(imageData, x, y, [80, 80, 80, 255]);
    }
  }
  setPixel(imageData, 2, 2, [225, 225, 225, 255]);

  assert.equal(cleanIconPixels(imageData), true);
  assert.equal(alphaAt(imageData, 0, 0), 0);
  assert.equal(alphaAt(imageData, 4, 2), 0);
  assert.equal(alphaAt(imageData, 2, 2), 255);
  assert.equal(alphaAt(imageData, 1, 2), 255);
});

test("leaves already transparent artwork untouched", () => {
  const imageData = image(2, 2, [225, 225, 225, 255]);
  setPixel(imageData, 0, 0, [0, 0, 0, 0]);
  const before = imageData.data.slice();

  assert.equal(cleanIconPixels(imageData), false);
  assert.deepEqual(imageData.data, before);
});

test("can still remove a dark checkerboard connected to the edge", () => {
  const imageData = image(3, 3, [30, 30, 30, 255]);
  setPixel(imageData, 1, 1, [150, 75, 150, 255]);

  assert.equal(cleanIconPixels(imageData), true);
  assert.equal(alphaAt(imageData, 0, 1), 0);
  assert.equal(alphaAt(imageData, 1, 1), 255);
});
