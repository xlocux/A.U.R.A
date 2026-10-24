"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { isExistingFile, isInsidePath } = require("../http-utils");

const IMAGE_PATTERN = /\.(png|jpe?g|webp)$/i;
const MAX_IMAGES_PER_RUN = 80;

function screenshotOutputDir(screenshot) {
  const raw = String(screenshot?.output_dir || "").trim();
  return raw ? path.resolve(raw) : null;
}

function collectScreenshotImages(outputDir, currentDir, images) {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    if (images.length >= MAX_IMAGES_PER_RUN) return;
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      collectScreenshotImages(outputDir, fullPath, images);
      continue;
    }
    if (!entry.isFile() || !IMAGE_PATTERN.test(entry.name)) continue;
    images.push({ name: entry.name, relativePath: path.relative(outputDir, fullPath) });
  }
}

function listScreenshotImages(screenshot) {
  const outputDir = screenshotOutputDir(screenshot);
  if (!outputDir) return [];
  try {
    if (!fs.statSync(outputDir).isDirectory()) return [];
  } catch {
    return [];
  }
  const images = [];
  collectScreenshotImages(outputDir, outputDir, images);
  return images;
}

function withScreenshotImages(screenshot) {
  return {
    ...screenshot,
    images: listScreenshotImages(screenshot).map((image) => ({
      ...image,
      url: `/api/recon-screenshots/${screenshot.id}/image?path=${encodeURIComponent(image.relativePath)}`
    }))
  };
}

// Returns the absolute image path only when it stays inside the screenshot run's output directory.
function resolveScreenshotImage(screenshot, relativeImagePath) {
  const outputDir = screenshotOutputDir(screenshot);
  if (!outputDir || !relativeImagePath) return null;
  const imagePath = path.resolve(outputDir, String(relativeImagePath));
  if (!isInsidePath(imagePath, outputDir) || !IMAGE_PATTERN.test(imagePath)) return null;
  return isExistingFile(imagePath) ? imagePath : null;
}

module.exports = {
  listScreenshotImages,
  resolveScreenshotImage,
  withScreenshotImages
};
