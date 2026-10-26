import { useEffect, useRef, useState } from 'react';
import { getOrderHighlightViewUrl, listOrderHighlights, uploadOrderHighlight } from '../api/orderHighlights';
import { MAX_HIGHLIGHT_BYTES, normalizeHighlightTitle, titleFromFile, validateHighlightFile } from '../utils/orderHighlightValidation';
import '../styles/OrderHighlights.css';

const dateLabel = value => value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const sizeLabel = value => Number.isFinite(value) ? `${(value / (1024 * 1024)).toFixed(1)} MB` : '';

function PlayIcon({ size = 24 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9 5 11 7-11 7V5Z" fill="currentColor" stroke="currentColor" strokeLinejoin="round" /></svg>;
}

function FilmIcon({ size = 28 }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="5" y="7" width="22" height="18" rx="3" stroke="currentColor" strokeWidth="1.7"/><path d="M10 7v18M22 7v18M5 13h5m-5 6h5m12-6h5m-5 6h5" stroke="currentColor" strokeWidth="1.7"/><path d="m14 12 5 4-5 4v-8Z" fill="currentColor" /></svg>;
}

function UploadIcon() {
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 16V3m0 0L7 8m5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export default function OrderHighlights({ orderId }) {
  const [highlights, setHighlights] = useState([]);
  const [canUpload, setCanUpload] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [activeId, setActiveId] = useState(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState('');
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [formError, setFormError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadedMessage, setUploadedMessage] = useState('');
  const [dragging, setDragging] = useState(false);
  const [reload, setReload] = useState(0);
  const inputRef = useRef(null);
  const uploadAbort = useRef(null);
  const playbackAbort = useRef(null);
  const active = highlights.find(item => item.id === activeId) || highlights[0] || null;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    listOrderHighlights(orderId, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      const items = Array.isArray(data.highlights) ? data.highlights : [];
      setHighlights(items);
      setCanUpload(Boolean(data.canUpload));
      setActiveId(current => items.some(item => item.id === current) ? current : items[0]?.id || null);
      setLoading(false);
    }).catch(error => {
      if (controller.signal.aborted) return;
      setLoadError(error.message || 'Could not load highlights.');
      setLoading(false);
    });
    return () => controller.abort();
  }, [orderId, reload]);

  useEffect(() => () => {
    uploadAbort.current?.abort();
    playbackAbort.current?.abort();
  }, []);

  async function openHighlight(id) {
    playbackAbort.current?.abort();
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

  function chooseFile(nextFile) {
    const validation = validateHighlightFile(nextFile);
    setFormError(validation);
    setUploadedMessage('');
    setFile(validation ? null : nextFile);
    if (!validation && !title.trim()) setTitle(titleFromFile(nextFile));
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
    try {
      const saved = await uploadOrderHighlight(orderId, { file, title: cleanTitle, onProgress: setProgress, signal: controller.signal });
      if (controller.signal.aborted) return;
      setFile(null);
      setTitle('');
      if (inputRef.current) inputRef.current.value = '';
      setUploadedMessage('Highlight added. The customer can watch it now.');
      setVideoUrl('');
      if (saved?.id) setActiveId(saved.id);
      setReload(value => value + 1);
    } catch (error) {
      if (error.name !== 'AbortError') setFormError(error.message || 'Could not upload this clip.');
    } finally {
      setUploading(false);
      uploadAbort.current = null;
    }
  }

  return <section className="order-highlights" aria-labelledby="order-highlights-title">
    <header className="highlight-intro">
      <div>
        <p className="highlight-eyebrow"><span className="highlight-eyebrow-dot" /> ORDER HIGHLIGHTS</p>
        <h2 id="order-highlights-title">The moments worth keeping.</h2>
        <p>Watch the best moments from this order, uploaded by your FastBoost team.</p>
      </div>
      <div className="highlight-intro-mark" aria-hidden="true"><FilmIcon size={35} /><span>PLAY / WATCH / RELIVE</span></div>
    </header>

    {loading ? <div className="highlight-loading" role="status" aria-label="Loading highlights"><div className="highlight-loading-screen" /><div className="highlight-loading-lines"><span /><span /></div></div>
      : loadError ? <div className="highlight-message-panel" role="alert"><FilmIcon /><h3>Highlights are unavailable</h3><p>{loadError}</p><button type="button" onClick={() => setReload(value => value + 1)}>Try again</button></div>
      : <>
        {active ? <>
          <div className="highlight-feature">
            <div className="highlight-stage">
              <div className="highlight-stage-media">
                {videoUrl ? <video key={videoUrl} controls playsInline autoPlay preload="metadata" src={videoUrl}
                  aria-label={`Play ${active.title}`} onError={() => { setVideoUrl(''); setVideoError('Playback stopped. Open the clip again to refresh its link.'); }} />
                  : <div className="highlight-stage-poster">
                    <div className="highlight-poster-orbit highlight-poster-orbit-outer" /><div className="highlight-poster-orbit highlight-poster-orbit-inner" />
                    <span className="highlight-poster-number">{String(highlights.findIndex(item => item.id === active.id) + 1).padStart(2, '0')}</span>
                    <button className="highlight-play-button" type="button" onClick={() => openHighlight(active.id)} disabled={videoLoading}
                      aria-label={`Play ${active.title}`}><PlayIcon size={29} /></button>
                    <span className="highlight-poster-label">READY WHEN YOU ARE</span>
                  </div>}
                {videoLoading && <div className="highlight-video-wait" role="status">Opening clip…</div>}
              </div>
              <div className="highlight-stage-meta">
                <div><span className="highlight-section-kicker">NOW SHOWING</span><h3>{active.title}</h3><p>By {active.uploader?.username || 'FastBoost team'} <span aria-hidden="true">·</span> {dateLabel(active.createdAt)}</p></div>
                <span className="highlight-format">{active.mimeType === 'video/webm' ? 'WEBM' : 'MP4'}</span>
              </div>
              {videoError && <div className="highlight-player-error" role="alert"><span>{videoError}</span><button type="button" onClick={() => openHighlight(active.id)}>Open again</button></div>}
            </div>
            <aside className="highlight-feature-side">
              <span className="highlight-section-kicker">YOUR CLIP COLLECTION</span>
              <h3>Every play has a story.</h3>
              <p>Select a clip below to watch it here. Highlights are visible to this order's customer and team.</p>
              <div className="highlight-stat"><strong>{String(highlights.length).padStart(2, '0')}</strong><span>{highlights.length === 1 ? 'highlight' : 'highlights'} saved</span></div>
              <div className="highlight-side-rule" /><span className="highlight-side-footnote">Captured by people. Shared with purpose.</span>
            </aside>
          </div>
          <div className="highlight-library-heading"><div><span className="highlight-section-kicker">THE LIBRARY</span><h3>Choose a moment</h3></div><span>{highlights.length} {highlights.length === 1 ? 'clip' : 'clips'}</span></div>
          <div className="highlight-library">
            {highlights.map((item, index) => <button className={`highlight-clip ${active.id === item.id ? 'is-active' : ''}`} type="button" key={item.id}
              onClick={() => openHighlight(item.id)} aria-pressed={active.id === item.id}>
              <span className="highlight-clip-art"><span className="highlight-clip-number">{String(index + 1).padStart(2, '0')}</span><span className="highlight-clip-play"><PlayIcon size={18} /></span><span className="highlight-clip-format">{item.mimeType === 'video/webm' ? 'WEBM' : 'MP4'}</span></span>
              <span className="highlight-clip-info"><strong>{item.title}</strong><small>{item.uploader?.username || 'FastBoost team'} <span aria-hidden="true">·</span> {dateLabel(item.createdAt)}</small><small>{sizeLabel(item.byteSize)}</small></span>
            </button>)}
          </div>
        </> : <div className="highlight-empty"><div className="highlight-empty-art" aria-hidden="true"><FilmIcon size={58} /><span className="highlight-empty-ray highlight-empty-ray-one" /><span className="highlight-empty-ray highlight-empty-ray-two" /></div><span className="highlight-section-kicker">THE FIRST FRAME IS WAITING</span><h3>No highlights yet</h3><p>{canUpload ? 'Upload a clip to show the customer a moment from this order.' : 'Your FastBoost team can add clips here for you to watch.'}</p></div>}

        {canUpload && <form className="highlight-upload" onSubmit={submitHighlight}>
          <div className="highlight-upload-copy"><span className="highlight-section-kicker">ADD A MOMENT</span><h3>Upload a highlight</h3><p>Share a short play from this order. The customer can watch it as soon as the upload finishes.</p></div>
          <div className="highlight-upload-fields">
            <label className="highlight-title-label" htmlFor={`highlight-title-${orderId}`}>Clip title</label>
            <input id={`highlight-title-${orderId}`} type="text" value={title} maxLength={100} placeholder="e.g. Final push to Gold" disabled={uploading}
              onChange={event => { setTitle(event.target.value); setFormError(''); }} />
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
            <div className="highlight-upload-actions"><button type="submit" disabled={uploading || !file}>{uploading ? 'Uploading…' : 'Add highlight'} <span aria-hidden="true">↗</span></button>{uploading && <button className="highlight-cancel" type="button" onClick={() => uploadAbort.current?.abort()}>Cancel upload</button>}</div>
          </div>
        </form>}
      </>}
  </section>;
}
