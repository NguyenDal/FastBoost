export const MAX_HIGHLIGHT_BYTES = 100 * 1024 * 1024;

const formats = [
  { extension: '.mp4', mimeType: 'video/mp4' },
  { extension: '.webm', mimeType: 'video/webm' },
];

export function validateHighlightFile(file) {
  if (!file) return 'Choose an MP4 or WebM clip.';
  const name = String(file.name || '').toLowerCase();
  const format = formats.find(item => name.endsWith(item.extension));
  if (!format || (file.type && file.type !== format.mimeType)) return 'Use an MP4 or WebM video.';
  if (!Number.isFinite(file.size) || file.size <= 0) return 'Choose a video with content.';
  if (file.size > MAX_HIGHLIGHT_BYTES) return 'Choose a clip under 100 MB.';
  return '';
}

export function normalizeHighlightTitle(value) {
  return String(value || '').trim().split('').filter(char => {
    const code = char.charCodeAt(0);
    return code >= 32 && code !== 127;
  }).join('').slice(0, 100);
}

export function titleFromFile(file) {
  const name = String(file?.name || '').replace(/\.(mp4|webm)$/i, '').replace(/[_-]+/g, ' ').trim();
  return normalizeHighlightTitle(name) || 'Match highlight';
}
