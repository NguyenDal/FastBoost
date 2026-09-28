import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supportRequest } from '../api/support';
import SupportPdfPreview from './SupportPdfPreview';

export default function SupportAttachmentPreview({ message, onClose }) {
    const dialog = useRef(null);
    const [preview, setPreview] = useState(null);
    const [error, setError] = useState('');
    const [downloading, setDownloading] = useState(false);
    useEffect(() => {
        const element = dialog.current;
        element.showModal();
        return () => element.close();
    }, []);
    useEffect(() => {
        let stopped = false;
        supportRequest(`/attachments/${message.id}/preview`).then(data => {
            if (!stopped) setPreview(data);
        }).catch(err => { if (!stopped) setError(err.message); });
        return () => { stopped = true; };
    }, [message.id]);
    async function download() {
        setDownloading(true);
        try {
            const { url } = await supportRequest(`/attachments/${message.id}?download=1`);
            const link = document.createElement('a');
            link.href = url; link.rel = 'noopener noreferrer'; link.target = '_blank'; link.click();
        } catch (err) { setError(err.message); }
        finally { setDownloading(false); }
    }
    return createPortal(<dialog ref={dialog} className="support-preview" aria-labelledby="support-preview-title" onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => event.stopPropagation()}>
        <header className="support-preview-header"><div><span>ATTACHMENT PREVIEW</span><h2 id="support-preview-title">{message.attachmentName}</h2></div><button type="button" aria-label="Close attachment preview" onClick={onClose}>×</button></header>
        <div className="support-preview-content">
            {error && <p className="support-preview-notice" role="alert">{error}</p>}
            {!preview && !error && <p className="support-preview-notice" role="status">Opening preview…</p>}
            {preview?.kind === 'image' && <img src={preview.url} alt={message.attachmentName} onError={() => setError('This image could not be displayed.')} />}
            {preview?.kind === 'pdf' && <SupportPdfPreview messageId={message.id} />}
            {preview?.kind === 'text' && <article className="support-preview-document">{preview.document && <p className="support-preview-caption">Word document · text preview</p>}<div>{preview.text || 'This document contains no readable text.'}</div>{preview.truncated && <p className="support-preview-caption">Preview shortened for this large document.</p>}</article>}
            {preview?.kind === 'unsupported' && <p className="support-preview-notice">Preview isn’t available for this file format. You can save a copy to open it.</p>}
        </div>
        <footer className="support-preview-footer"><span>{Math.max(1, Math.round(message.attachmentSize / 1024))} KB</span><button type="button" onClick={download} disabled={downloading}>{downloading ? 'Preparing…' : 'Download a copy'}</button></footer>
    </dialog>, document.body);
}
