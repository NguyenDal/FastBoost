import { useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../api/config';
import '../styles/SocialLinkConfirmation.css';

export default function SocialLinkConfirmation({ pending, logo, onCancel, onSuccess }) {
  const dialog = useRef(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const name = pending.provider === 'google' ? 'Google' : 'Discord';
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);
  const allow = async () => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/auth/social/confirm-link`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkToken: pending.linkToken, allow: true }),
      });
      const data = await response.json();
      if (!response.ok || !data.token) throw new Error(data.error || 'Could not link your account. Please try again.');
      onSuccess(data);
    } catch (failure) { setError(failure.message || 'Could not link your account. Please try again.'); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <dialog ref={dialog} className="social-link-dialog" aria-labelledby="social-link-title" aria-describedby="social-link-description" onCancel={event => { event.preventDefault(); if (!submitting.current) onCancel(); }}>
    <div className="social-link-illustration" aria-hidden="true">
      <div className="social-link-identity"><span className="social-link-avatar"><img src="https://fastboost-assets.s3.ca-central-1.amazonaws.com/logos/fastboost-logo.png" alt="" /></span></div>
      <span className="social-link-connector"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 1)"/></svg></span>
      <div className="social-link-identity"><span className="social-link-avatar social-link-provider">{logo}</span></div>
    </div>
    <h2 id="social-link-title">Link with {name}?</h2>
    <p id="social-link-description">You already have a FastBoost account with this email. Continuing will link your {name} account for faster sign-in.</p>
    <div className="social-link-benefit"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d="m13 2-9 12h7l-1 8 10-13h-7z"/></svg><span>Same account. Faster sign-in.</span></div>
    {error && <p role="alert" className="auth-error-message">{error}</p>}
    <div className="social-link-actions">
      <button autoFocus type="button" className="social-link-cancel" disabled={busy} onClick={onCancel}>Not now</button>
      <button type="button" className="social-link-allow" disabled={busy} onClick={allow}>{busy ? 'Linking...' : 'Link & sign in'}</button>
    </div>
  </dialog>;
}
