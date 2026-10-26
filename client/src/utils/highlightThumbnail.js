const MAX_THUMBNAIL_BYTES = 200 * 1024;
const abortError = () => new DOMException('Preview cancelled.', 'AbortError');

const toJpeg = (canvas, quality) => new Promise((resolve, reject) => {
  canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not capture a video frame.')), 'image/jpeg', quality);
});

export async function createHighlightThumbnail(source, { signal, remote = false } = {}) {
  if (signal?.aborted) throw abortError();
  const localUrl = source instanceof Blob ? URL.createObjectURL(source) : null;
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  if (remote) video.crossOrigin = 'anonymous';

  try {
    await new Promise((resolve, reject) => {
      let settled = false;
      let seeking = false;
      const timer = setTimeout(() => finish(new Error('The video preview timed out.')), 12000);
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener('loadedmetadata', onMetadata);
        video.removeEventListener('loadeddata', onData);
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('canplay', onCanPlay);
        video.removeEventListener('error', onError);
        signal?.removeEventListener('abort', onAbort);
      };
      const finish = error => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve();
      };
      const onMetadata = () => {
        if (!video.videoWidth || !video.videoHeight) return;
        const seekTime = Number.isFinite(video.duration) && video.duration > 0.35 ? Math.min(1, video.duration / 3) : 0;
        if (seekTime > 0) {
          try {
            seeking = true;
            video.currentTime = seekTime;
            return;
          } catch { seeking = false; }
        }
        if (video.readyState >= 2) finish();
      };
      const onData = () => {
        if (seeking) return;
        finish(video.videoWidth && video.videoHeight ? undefined : new Error('This video has no frame to preview.'));
      };
      const onSeeked = () => {
        if (video.readyState >= 2) finish();
        else seeking = false;
      };
      const onCanPlay = () => { if (!seeking && video.readyState >= 2) finish(); };
      const onError = () => finish(new Error('Could not load a frame from this video.'));
      const onAbort = () => finish(abortError());
      video.addEventListener('loadedmetadata', onMetadata);
      video.addEventListener('loadeddata', onData);
      video.addEventListener('seeked', onSeeked);
      video.addEventListener('canplay', onCanPlay);
      video.addEventListener('error', onError);
      signal?.addEventListener('abort', onAbort, { once: true });
      video.src = localUrl || source;
      video.load();
    });

    if (signal?.aborted) throw abortError();
    if (video.readyState < 2) throw new Error('The video frame is not ready.');
    const scale = Math.min(1, 480 / video.videoWidth, 270 / video.videoHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare the video preview.');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    let blob = await toJpeg(canvas, 0.72);
    if (blob.size > MAX_THUMBNAIL_BYTES) blob = await toJpeg(canvas, 0.5);
    if (blob.size > MAX_THUMBNAIL_BYTES) blob = await toJpeg(canvas, 0.35);
    if (blob.size > MAX_THUMBNAIL_BYTES) throw new Error('The video preview is too large.');
    if (signal?.aborted) throw abortError();
    return new File([blob], 'highlight-thumbnail.jpg', { type: 'image/jpeg' });
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (localUrl) URL.revokeObjectURL(localUrl);
  }
}
