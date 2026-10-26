import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getOrderHighlightThumbnailUrl, getOrderHighlightViewUrl, listOrderHighlights, uploadOrderHighlight, uploadOrderHighlightThumbnail } from '../api/orderHighlights';
import { MAX_HIGHLIGHT_BYTES, normalizeHighlightTitle, titleFromFile, validateHighlightFile } from '../utils/orderHighlightValidation';
import { createHighlightThumbnail } from '../utils/highlightThumbnail';
import { isHighlightTitlePreset } from '../utils/highlightTitlePresets';
import HighlightTitlePicker from './HighlightTitlePicker';
import OrderHighlightsIntro, { FilmIcon } from './OrderHighlightsIntro';
import OrderHighlightsSkeleton from './OrderHighlightsSkeleton';
import '../styles/OrderHighlights.css';

const dateLabel = value => value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const sizeLabel = value => Number.isFinite(value) ? `${(value / (1024 * 1024)).toFixed(1)} MB` : '';
const durationLabel = value => {
  if (!Number.isFinite(value) || value < 0) return '';
  const totalSeconds = Math.max(1, Math.floor(value));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
};
const zoomTransform = (source, target) => `translate(${source.left - target.left}px, ${source.top - target.top}px) scale(${source.width / target.width}, ${source.height / target.height})`;
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let legacyPreviewQueue = Promise.resolve();
const queueLegacyPreview = task => {
  const result = legacyPreviewQueue.then(task, task);
  legacyPreviewQueue = result.catch(() => {});
  return result;
};

function PlayIcon({ size = 24 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 5 11 7-11 7V5Z" fill="currentColor" stroke="currentColor" strokeLinejoin="round" /></svg>;
}

function UploadIcon() {
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 16V3m0 0L7 8m5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function HighlightRowPreview({ orderId, item, canUpload, localThumbnailUrl, previewPending }) {
  const previewRef = useRef(null);
  const [imageUrl, setImageUrl] = useState('');
  const [readyUrl, setReadyUrl] = useState('');
  const [failedUrl, setFailedUrl] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(true);
  const highlightId = item.id;
  const hasThumbnail = Boolean(item.hasThumbnail);

  useEffect(() => {
    const controller = new AbortController();
    let localUrl;
    let started = false;
    if (localThumbnailUrl || previewPending) return undefined;
    const loadPreview = async () => {
      try {
        if (hasThumbnail) {
          try {
            const url = await getOrderHighlightThumbnailUrl(orderId, highlightId, controller.signal);
            if (!controller.signal.aborted) setImageUrl(url);
            return;
          } catch {
            if (controller.signal.aborted) return;
            // A missing stored preview can still be recovered from the private video.
          }
        }
        const thumbnail = await queueLegacyPreview(async () => {
          if (controller.signal.aborted) throw new DOMException('Preview cancelled.', 'AbortError');
          const videoUrl = await getOrderHighlightViewUrl(orderId, highlightId, controller.signal);
          return createHighlightThumbnail(videoUrl, { signal: controller.signal, remote: true });
        });
        if (controller.signal.aborted) return;
        localUrl = URL.createObjectURL(thumbnail);
        setImageUrl(localUrl);
        if (canUpload) await uploadOrderHighlightThumbnail(orderId, highlightId, thumbnail, controller.signal);
      } catch {
        // Keep the branded preview when the private frame cannot be decoded.
        if (!controller.signal.aborted) setLoadingPreview(false);
      }
    };
    const observer = new IntersectionObserver(entries => {
      if (!started && entries.some(entry => entry.isIntersecting)) {
        started = true;
        observer.disconnect();
        setLoadingPreview(true);
        loadPreview();
      }
    }, { rootMargin: '80px 0px' });
    if (previewRef.current) observer.observe(previewRef.current);
    return () => {
      observer.disconnect();
      controller.abort();
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [orderId, highlightId, hasThumbnail, canUpload, localThumbnailUrl, previewPending]);

  const displayUrl = localThumbnailUrl || imageUrl;
  const usableUrl = displayUrl && displayUrl !== failedUrl ? displayUrl : '';
  const imageReady = Boolean(usableUrl && readyUrl === usableUrl);
  const showSkeleton = Boolean(previewPending || loadingPreview || (usableUrl && !imageReady));
  const markFailed = () => {
    setFailedUrl(usableUrl);
    setLoadingPreview(false);
    if (!localThumbnailUrl) setImageUrl('');
  };
  return <div className={`highlight-row-preview ${imageReady ? 'has-image' : ''} ${showSkeleton ? 'is-loading' : ''}`} ref={previewRef} aria-hidden="true">
    {usableUrl && <img className={`highlight-row-preview-image ${imageReady ? 'is-ready' : ''}`} src={usableUrl} alt="" decoding="async"
      onLoad={event => {
        const image = event.currentTarget;
        Promise.resolve(typeof image.decode === 'function' ? image.decode() : undefined).then(() => {
          if (image.isConnected && image.getAttribute('src') === usableUrl) {
            setReadyUrl(usableUrl);
            setLoadingPreview(false);
          }
        }).catch(markFailed);
      }} onError={markFailed} />}
    {!showSkeleton && <span className="highlight-row-preview-icon">{imageReady ? <PlayIcon size={25} /> : <FilmIcon size={35} />}</span>}
  </div>;
}

export default function OrderHighlights({ orderId, gameMode = 'lol' }) {
  const [highlights, setHighlights] = useState([]);
  const [canUpload, setCanUpload] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [activeId, setActiveId] = useState(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState('');
  const [mediaDurations, setMediaDurations] = useState({});
  const [localThumbnailUrls, setLocalThumbnailUrls] = useState({});
  const [previewPendingIds, setPreviewPendingIds] = useState({});
  const [file, setFile] = useState(null);
  const [titleMode, setTitleMode] = useState('preset');
  const [presetTitle, setPresetTitle] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [formError, setFormError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadedMessage, setUploadedMessage] = useState('');
  const [dragging, setDragging] = useState(false);
  const [reload, setReload] = useState(0);
  const inputRef = useRef(null);
  const uploadAbort = useRef(null);
  const playbackAbort = useRef(null);
  const thumbnailSaveAborts = useRef(new Set());
  const thumbnailCaptureAborts = useRef(new Set());
  const thumbnailPreparation = useRef(null);
  const localThumbnailObjects = useRef(new Set());
  const mountedRef = useRef(true);
  const rowRefs = useRef(new Map());
  const triggerRef = useRef(null);
  const dialogRef = useRef(null);
  const dialogCardRef = useRef(null);
  const backdropRef = useRef(null);
  const closeButtonRef = useRef(null);
  const videoRef = useRef(null);
  const entranceAnimations = useRef([]);
  const closingRef = useRef(false);
  const closeHighlightRef = useRef(null);
  const active = highlights.find(item => item.id === activeId) || null;
  const title = titleMode === 'custom'
    ? customTitle
    : (isHighlightTitlePreset(gameMode, presetTitle) ? presetTitle : '');

  useEffect(() => {
    setPresetTitle(current => current && !isHighlightTitlePreset(gameMode, current) ? '' : current);
  }, [gameMode]);

  useEffect(() => {
    const controller = new AbortController();
    playbackAbort.current?.abort();
    setActiveId(null);
    setVideoUrl('');
    setVideoError('');
    setVideoLoading(false);
    setLoading(true);
    setLoadError('');
    listOrderHighlights(orderId, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      const items = Array.isArray(data.highlights) ? data.highlights : [];
      setHighlights(items);
      setCanUpload(Boolean(data.canUpload));
      setLoading(false);
    }).catch(error => {
      if (controller.signal.aborted) return;
      setLoadError(error.message || 'Could not load highlights.');
      setLoading(false);
    });
    return () => controller.abort();
  }, [orderId, reload]);

  useEffect(() => {
    mountedRef.current = true;
    const saveControllers = thumbnailSaveAborts.current;
    const captureControllers = thumbnailCaptureAborts.current;
    const localObjects = localThumbnailObjects.current;
    return () => {
      mountedRef.current = false;
      uploadAbort.current?.abort();
      playbackAbort.current?.abort();
      saveControllers.forEach(controller => controller.abort());
      captureControllers.forEach(controller => controller.abort());
      localObjects.forEach(url => URL.revokeObjectURL(url));
      entranceAnimations.current.forEach(animation => animation.cancel());
    };
  }, []);

  useLayoutEffect(() => {
    if (!activeId) return undefined;
    const dialog = dialogRef.current;
    const card = dialogCardRef.current;
    const backdrop = backdropRef.current;
    if (!dialog || !card) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (!dialog.open) dialog.showModal();
    closeButtonRef.current?.focus();
    const closeOutsideCard = event => {
      const bounds = card.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
        closeHighlightRef.current?.();
      }
    };
    document.addEventListener('pointerdown', closeOutsideCard, true);
    document.addEventListener('click', closeOutsideCard, true);

    const source = rowRefs.current.get(activeId)?.getBoundingClientRect();
    const target = card.getBoundingClientRect();
    if (source && target.width && target.height && !prefersReducedMotion()) {
      entranceAnimations.current = [
        card.animate([
          { transform: zoomTransform(source, target), opacity: 0.8 },
          { transform: 'none', opacity: 1 },
        ], { duration: 320, easing: 'cubic-bezier(0.2, 0.85, 0.2, 1)' }),
        backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' }),
      ];
    }

    return () => {
      entranceAnimations.current.forEach(animation => animation.cancel());
      entranceAnimations.current = [];
      document.removeEventListener('pointerdown', closeOutsideCard, true);
      document.removeEventListener('click', closeOutsideCard, true);
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [activeId]);

  async function openHighlight(id, trigger) {
    playbackAbort.current?.abort();
    if (trigger) triggerRef.current = trigger;
    const controller = new AbortController();
    playbackAbort.current = controller;
    setActiveId(id);
    setVideoUrl('');
    setVideoError('');
    setVideoLoading(true);
    try {
      const url = await getOrderHighlightViewUrl(orderId, id, controller.signal);
      if (!controller.signal.aborted) setVideoUrl(url);
    } catch (error) {
      if (!controller.signal.aborted) setVideoError(error.message || 'Could not open this clip.');
    } finally {
      if (!controller.signal.aborted) setVideoLoading(false);
    }
  }

  function closeHighlight() {
    if (closingRef.current) return;
    closingRef.current = true;
    playbackAbort.current?.abort();
    videoRef.current?.pause();
    entranceAnimations.current.forEach(animation => animation.cancel());
    entranceAnimations.current = [];

    const finish = () => {
      setActiveId(null);
      setVideoUrl('');
      setVideoError('');
      setVideoLoading(false);
      closingRef.current = false;
      requestAnimationFrame(() => triggerRef.current?.focus());
    };
    const card = dialogCardRef.current;
    const backdrop = backdropRef.current;
    const source = rowRefs.current.get(activeId)?.getBoundingClientRect();
    const target = card?.getBoundingClientRect();
    if (!source || !target?.width || !target?.height || prefersReducedMotion()) {
      finish();
      return;
    }
    const cardAnimation = card.animate([
      { transform: 'none', opacity: 1 },
      { transform: zoomTransform(source, target), opacity: 0.78 },
    ], { duration: 250, easing: 'cubic-bezier(0.4, 0, 0.8, 0.3)' });
    const backdropAnimation = backdrop.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, easing: 'ease-in' });
    Promise.allSettled([cardAnimation.finished, backdropAnimation.finished]).then(finish);
  }

  useEffect(() => { closeHighlightRef.current = closeHighlight; });

  function rememberDuration(id, duration) {
    if (!Number.isFinite(duration) || duration <= 0) return;
    setMediaDurations(current => current[id] === duration ? current : { ...current, [id]: duration });
  }

  function prepareThumbnail(nextFile) {
    const controller = new AbortController();
    thumbnailCaptureAborts.current.add(controller);
    const promise = createHighlightThumbnail(nextFile, { signal: controller.signal })
      .catch(() => null)
      .finally(() => thumbnailCaptureAborts.current.delete(controller));
    const preparation = { file: nextFile, controller, promise };
    thumbnailPreparation.current = preparation;
    return preparation;
  }

  function chooseFile(nextFile) {
    thumbnailPreparation.current?.controller.abort();
    thumbnailPreparation.current = null;
    const validation = validateHighlightFile(nextFile);
    setFormError(validation);
    setUploadedMessage('');
    setFile(validation ? null : nextFile);
    if (!validation && titleMode === 'custom' && !customTitle.trim()) setCustomTitle(titleFromFile(nextFile));
    if (!validation) prepareThumbnail(nextFile);
    if (validation && inputRef.current) inputRef.current.value = '';
  }

  async function submitHighlight(event) {
    event.preventDefault();
    const validation = validateHighlightFile(file);
    const cleanTitle = normalizeHighlightTitle(title);
    if (validation || !cleanTitle) {
      setFormError(validation || 'Add a short title for this clip.');
      return;
    }
    const controller = new AbortController();
    uploadAbort.current = controller;
    setUploading(true);
    setProgress(0);
    setFormError('');
    setUploadedMessage('');
    const preparation = thumbnailPreparation.current?.file === file && !thumbnailPreparation.current.controller.signal.aborted
      ? thumbnailPreparation.current : prepareThumbnail(file);
    try {
      const saved = await uploadOrderHighlight(orderId, { file, title: cleanTitle, onProgress: setProgress, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (thumbnailPreparation.current === preparation) thumbnailPreparation.current = null;
      setFile(null);
      setPresetTitle('');
      setCustomTitle('');
      if (inputRef.current) inputRef.current.value = '';
      setUploadedMessage('Highlight added. The customer can watch it now.');
      setVideoUrl('');
      setUploading(false);
      uploadAbort.current = null;
      if (saved?.id) setPreviewPendingIds(current => ({ ...current, [saved.id]: true }));
      setReload(value => value + 1);
      preparation.promise.then(thumbnail => {
        if (!mountedRef.current || !saved?.id || !thumbnail) return;
        const localUrl = URL.createObjectURL(thumbnail);
        localThumbnailObjects.current.add(localUrl);
        setLocalThumbnailUrls(current => ({ ...current, [saved.id]: localUrl }));
        const previewController = new AbortController();
        thumbnailSaveAborts.current.add(previewController);
        const timeout = setTimeout(() => previewController.abort(), 8000);
        uploadOrderHighlightThumbnail(orderId, saved.id, thumbnail, previewController.signal).catch(() => {
          // The clip and its local preview remain available this session.
        }).finally(() => {
          clearTimeout(timeout);
          thumbnailSaveAborts.current.delete(previewController);
        });
      }).catch(() => {}).finally(() => {
        if (mountedRef.current && saved?.id) setPreviewPendingIds(current => {
          const next = { ...current };
          delete next[saved.id];
          return next;
        });
      });
    } catch (error) {
      if (error.name === 'AbortError') preparation.controller.abort();
      if (error.name !== 'AbortError') setFormError(error.message || 'Could not upload this clip.');
    } finally {
      setUploading(false);
      uploadAbort.current = null;
    }
  }

  return <section className="order-highlights" aria-labelledby="order-highlights-title">
    <OrderHighlightsIntro />

    {loading ? <OrderHighlightsSkeleton contentOnly />
      : loadError ? <div className="highlight-message-panel" role="alert"><FilmIcon /><h3>Highlights are unavailable</h3><p>{loadError}</p><button type="button" onClick={() => setReload(value => value + 1)}>Try again</button></div>
      : <>
        {highlights.length > 0 ? <ol className="highlight-list" aria-label="Order highlight clips">
          {highlights.map((item, index) => {
            const duration = durationLabel(mediaDurations[item.id] ?? item.durationSeconds);
            return <li className={`highlight-row ${activeId === item.id ? 'is-open' : ''}`} key={item.id}
              ref={node => { if (node) rowRefs.current.set(item.id, node); else rowRefs.current.delete(item.id); }}>
              <div className="highlight-row-main">
                <HighlightRowPreview orderId={orderId} item={item} canUpload={canUpload} localThumbnailUrl={localThumbnailUrls[item.id]} previewPending={Boolean(previewPendingIds[item.id])} />
                <div className="highlight-row-details">
                  <span className="highlight-row-kicker">Moment {String(index + 1).padStart(2, '0')}</span>
                  <h3>{item.title}</h3>
                  <p>By {item.uploader?.username || 'FastBoost team'} <span aria-hidden="true">·</span> {dateLabel(item.createdAt)}</p>
                  {duration && <div className="highlight-row-facts"><span>{duration}</span></div>}
                </div>
                <span className="highlight-watch-cue" aria-hidden="true"><PlayIcon size={15} />Watch clip</span>
                <button className="highlight-row-hit" type="button" onClick={event => openHighlight(item.id, event.currentTarget)}
                  aria-label={`Watch ${item.title}`} aria-haspopup="dialog" />
              </div>
            </li>;
          })}
        </ol> : <div className="highlight-empty"><div className="highlight-empty-art" aria-hidden="true"><FilmIcon size={58} /><span className="highlight-empty-ray highlight-empty-ray-one" /><span className="highlight-empty-ray highlight-empty-ray-two" /></div><span className="highlight-section-kicker">THE FIRST FRAME IS WAITING</span><h3>No highlights yet</h3><p>{canUpload ? 'Upload a clip to show the customer a moment from this order.' : 'Your FastBoost team can add clips here for you to watch.'}</p></div>}

        {canUpload && <form className="highlight-upload" onSubmit={submitHighlight}>
          <div className="highlight-upload-copy"><span className="highlight-section-kicker">ADD A MOMENT</span><h3>Upload a highlight</h3><p>Share a short play from this order. The customer can watch it as soon as the upload finishes.</p></div>
          <div className="highlight-upload-fields">
            <HighlightTitlePicker orderId={orderId} gameMode={gameMode} mode={titleMode} onModeChange={mode => {
              if (mode === 'custom' && file && !customTitle.trim()) setCustomTitle(titleFromFile(file));
              setTitleMode(mode);
              setFormError('');
            }}
              presetTitle={presetTitle} onPresetTitleChange={value => { setPresetTitle(value); setFormError(''); }}
              customTitle={customTitle} onCustomTitleChange={value => { setCustomTitle(value); setFormError(''); }} disabled={uploading} />
            <label className={`highlight-file-drop ${dragging ? 'is-dragging' : ''} ${file ? 'has-file' : ''}`} htmlFor={`highlight-file-${orderId}`}
              onDragOver={event => { event.preventDefault(); if (!uploading) setDragging(true); }}
              onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
              onDrop={event => { event.preventDefault(); setDragging(false); if (!uploading) chooseFile(event.dataTransfer.files?.[0]); }}>
              <UploadIcon /><strong>{file ? file.name : 'Choose a video or drop it here'}</strong><span>{file ? sizeLabel(file.size) : 'MP4 or WebM · up to 100 MB'}</span>
            </label>
            <input className="highlight-file-input" id={`highlight-file-${orderId}`} ref={inputRef} type="file" accept="video/mp4,video/webm,.mp4,.webm"
              disabled={uploading} onChange={event => chooseFile(event.target.files?.[0])} />
            <p className="highlight-upload-limit">Max size: {Math.round(MAX_HIGHLIGHT_BYTES / (1024 * 1024))} MB. Keep the clip focused on this customer's order.</p>
            {uploading && <div className="highlight-progress" role="status" aria-label={`Uploading ${progress}%`}><div className="highlight-progress-track"><span style={{ width: `${progress}%` }} /></div><span>{progress}% uploaded</span></div>}
            {formError && <p className="highlight-form-error" role="alert">{formError}</p>}
            {uploadedMessage && <p className="highlight-form-success" role="status">{uploadedMessage}</p>}
            <div className="highlight-upload-actions"><button type="submit" disabled={uploading || !file || !normalizeHighlightTitle(title)}>{uploading ? 'Uploading…' : 'Add highlight'} <span aria-hidden="true">↗</span></button>{uploading && <button className="highlight-cancel" type="button" onClick={() => uploadAbort.current?.abort()}>Cancel upload</button>}</div>
          </div>
        </form>}
      </>}

    {active && <dialog className="highlight-modal" ref={dialogRef} aria-labelledby={`highlight-dialog-title-${orderId}`}
      onCancel={event => { event.preventDefault(); closeHighlight(); }}
      onPointerDown={event => { if (event.target === event.currentTarget || event.target === backdropRef.current) closeHighlight(); }}>
      <div className="highlight-modal-backdrop" ref={backdropRef} aria-hidden="true" />
      <div className="highlight-modal-card" ref={dialogCardRef}>
        <div className="highlight-modal-heading">
          <div><span className="highlight-row-kicker">Moment {String(highlights.findIndex(item => item.id === active.id) + 1).padStart(2, '0')}</span>
            <h3 id={`highlight-dialog-title-${orderId}`}>{active.title}</h3></div>
          <button className="highlight-modal-close" ref={closeButtonRef} type="button" onClick={closeHighlight} aria-label="Close clip">×</button>
        </div>
        <div className="highlight-modal-media">
          {videoLoading && <div className="highlight-modal-wait" role="status"><FilmIcon size={38} /><span>Opening clip…</span></div>}
          {videoUrl && <video ref={videoRef} key={videoUrl} controls playsInline autoPlay preload="metadata" src={videoUrl}
            aria-label={`Play ${active.title}`} onLoadedMetadata={event => rememberDuration(active.id, event.currentTarget.duration)}
            onDurationChange={event => rememberDuration(active.id, event.currentTarget.duration)}
            onError={() => { setVideoUrl(''); setVideoError('Playback stopped. Open the clip again to refresh its link.'); }} />}
          {videoError && <div className="highlight-modal-error" role="alert"><p>{videoError}</p><button type="button" onClick={() => openHighlight(active.id)}>Open again</button></div>}
        </div>
      </div>
    </dialog>}
  </section>;
}
