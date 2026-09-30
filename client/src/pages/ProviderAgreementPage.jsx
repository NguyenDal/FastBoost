import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { loadProviderAgreement, downloadProviderAgreement } from '../api/providerAgreement';
import { clearExpiredSession, hasValidSession } from '../utils/authSession';
import '../styles/LegalDocument.css';

export default function ProviderAgreementPage() {
    const navigate = useNavigate();
    const [html, setHtml] = useState('');
    const [error, setError] = useState('');
    useEffect(() => {
        let active = true, controller;
        const signIn = () => navigate('/', { replace: true, state: { from: '/provider-agreement', openAuthModal: true, authMode: 'login' } });
        const load = async () => {
            controller?.abort();
            controller = new AbortController();
            const signal = controller.signal;
            setHtml(''); setError('');
            if (!hasValidSession()) return signIn();
            try {
                const document = await loadProviderAgreement(signal);
                if (active && !signal.aborted) setHtml(document);
            } catch (e) {
                if (!active || signal.aborted) return;
                if (e.status === 401) {
                    clearExpiredSession({ showExpiredModal: false });
                    signIn();
                } else setError(e.message);
            }
        };
        const storageChanged = event => { if (!event.key || ['token', 'user'].includes(event.key)) load(); };
        load();
        window.addEventListener('focus', load);
        window.addEventListener('pageshow', load);
        window.addEventListener('auth:changed', load);
        window.addEventListener('session:expired', load);
        window.addEventListener('storage', storageChanged);
        return () => {
            active = false; controller?.abort();
            window.removeEventListener('focus', load);
            window.removeEventListener('pageshow', load);
            window.removeEventListener('auth:changed', load);
            window.removeEventListener('session:expired', load);
            window.removeEventListener('storage', storageChanged);
        };
    }, [navigate]);

    const frameLoaded = event => {
        const button = event.currentTarget.contentDocument?.querySelector('[data-download-agreement]');
        button?.addEventListener('click', async () => {
            button.disabled = true;
            button.textContent = 'Downloading…';
            setError('');
            try { await downloadProviderAgreement(); }
            catch (e) {
                setError(e.message);
                if ([401, 403].includes(e.status)) setHtml('');
            } finally { button.disabled = false; button.textContent = 'Download review PDF'; }
        });
    };
    return <div className="legal-document-page">
        <Navbar />
        {error && <p className="legal-document-status" role="alert">{error}</p>}
        {!html && !error && <p className="legal-document-status" role="status">Loading agreement…</p>}
        {html && <iframe title="Provider Agreement" srcDoc={html} className="legal-document-frame" onLoad={frameLoaded} />}
    </div>;
}
