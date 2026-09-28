import { useEffect, useRef, useState } from 'react';
import { supportAttachmentData } from '../api/support';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export default function SupportPdfPreview({ messageId }) {
    const canvas = useRef(null);
    const container = useRef(null);
    const [pdf, setPdf] = useState(null);
    const [pageNumber, setPageNumber] = useState(1);
    const [width, setWidth] = useState(0);
    const [pageText, setPageText] = useState('');
    const [error, setError] = useState('');
    const [rendering, setRendering] = useState(true);
    useEffect(() => {
        const controller = new AbortController();
        let stopped = false;
        let loadingTask;
        async function load() {
            try {
                const [pdfjs, data] = await Promise.all([import('pdfjs-dist'), supportAttachmentData(messageId, controller.signal)]);
                if (stopped) return;
                pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
                loadingTask = pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true, maxImageSize: 16000000 });
                const document = await loadingTask.promise;
                if (!stopped) setPdf(document);
            } catch (err) { if (!stopped) setError(err.name === 'PasswordException' ? 'This PDF is password protected.' : 'This PDF could not be previewed.'); }
        }
        void load();
        return () => { stopped = true; controller.abort(); void loadingTask?.destroy().catch(() => {}); };
    }, [messageId]);
    useEffect(() => {
        const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
        observer.observe(container.current);
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        if (!pdf || !width) return;
        let stopped = false;
        let renderTask;
        async function render() {
            try {
                setRendering(true); setPageText('');
                const page = await pdf.getPage(pageNumber);
                if (stopped) return;
                const original = page.getViewport({ scale: 1 });
                const scale = Math.min(2, Math.max(1, width - 32) / original.width, 6000 / original.height);
                const viewport = page.getViewport({ scale });
                const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(16000000 / (viewport.width * viewport.height)));
                const element = canvas.current;
                element.width = Math.floor(viewport.width * ratio); element.height = Math.floor(viewport.height * ratio);
                element.style.width = `${viewport.width}px`; element.style.height = `${viewport.height}px`;
                renderTask = page.render({ canvasContext: element.getContext('2d'), viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
                await renderTask.promise;
                if (stopped) return;
                const text = await page.getTextContent();
                if (!stopped) { setPageText(text.items.map(item => `${item.str || ''}${item.hasEOL ? '\n' : ' '}`).join('')); setRendering(false); }
            } catch (err) { if (!stopped && err.name !== 'RenderingCancelledException') { setError('This PDF page could not be displayed.'); setRendering(false); } }
        }
        void render();
        return () => { stopped = true; renderTask?.cancel(); };
    }, [pdf, pageNumber, width]);
    return <div className="support-pdf" ref={container}>
        {pdf && <nav className="support-pdf-controls" aria-label="PDF pages"><button disabled={pageNumber === 1} onClick={() => setPageNumber(n => n - 1)}>Previous</button><span>Page {pageNumber} of {pdf.numPages}</span><button disabled={pageNumber === pdf.numPages} onClick={() => setPageNumber(n => n + 1)}>Next</button></nav>}
        {error ? <p className="support-preview-notice" role="alert">{error}</p> : <>{rendering && <p className="support-preview-notice" role="status">Rendering PDF…</p>}<canvas ref={canvas} aria-label={`PDF page ${pageNumber}`} />{pageText && <details className="support-pdf-text"><summary>Read page text</summary><div>{pageText}</div></details>}</>}
    </div>;
}
