import { useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../api/config';

function ProviderLogo({ provider }) {
  if (provider === 'google') return <svg aria-hidden="true" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6C44.4 38.03 46.98 31.86 46.98 24.55Z"/><path fill="#FBBC05" d="M10.53 28.59A14.5 14.5 0 0 1 9.77 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.87 23.87 0 0 0 0 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19Z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"/></svg>;
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="#5865F2"><path d="M20.32 4.37a19.8 19.8 0 0 0-4.88-1.51l-.6 1.23a18.3 18.3 0 0 0-5.42 0l-.61-1.23a19.7 19.7 0 0 0-4.88 1.52C.84 8.94 0 13.4.42 17.79a19.8 19.8 0 0 0 5.99 3.03l1.23-2a12.9 12.9 0 0 1-1.94-.94l.48-.37c3.76 1.72 7.85 1.72 11.56 0l.49.37c-.62.37-1.27.69-1.95.95l1.22 1.99a19.7 19.7 0 0 0 5.99-3.03c.5-5.09-.86-9.51-3.17-13.42ZM8.02 15.1c-1.13 0-2.05-1.03-2.05-2.29s.9-2.29 2.05-2.29c1.14 0 2.07 1.04 2.05 2.29 0 1.26-.9 2.29-2.05 2.29Zm7.96 0c-1.13 0-2.05-1.03-2.05-2.29s.9-2.29 2.05-2.29c1.14 0 2.07 1.04 2.05 2.29 0 1.26-.9 2.29-2.05 2.29Z"/></svg>;
}
export default function SocialAuthButtons({ mode = 'login', termsAccepted = false, promotionalEmails = false, rememberMe = false, referralCode = '', onSuccess, onError, onTermsRequired }) {
  const [providers, setProviders] = useState(null);
  const [busy, setBusy] = useState(false);
  const cleanup = useRef(() => {});
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE_URL}/auth/social/providers`, { signal: controller.signal }).then(r => r.ok ? r.json() : null).then(setProviders).catch(() => {});
    return () => { controller.abort(); cleanup.current(); };
  }, []);
  const start = provider => {
    if (mode === 'register' && !termsAccepted) { onTermsRequired?.(); return; }
    if (!providers?.[provider]) return onError('This sign-in option is not configured yet. Please use email and password.');
    cleanup.current();
    const url = new URL(`${API_BASE_URL}/auth/social/${provider}/start`, window.location.origin);
    for (const [key, value] of Object.entries({ origin: window.location.origin, mode, termsAccepted, promotionalEmails, rememberMe, referralCode })) url.searchParams.set(key, String(value));
    const popup = window.open(url.toString(), 'fastboost-social-auth', 'popup,width=520,height=720');
    if (!popup) return onError('Please allow the sign-in popup and try again.');
    setBusy(true); onError('');
    const finish = () => { cleanup.current(); setBusy(false); };
    const receive = event => {
      if (event.origin !== url.origin || event.source !== popup || event.data?.type !== 'fastboost:social-auth') return;
      finish();
      if (event.data.error) onError(event.data.error);
      else if (event.data.token && event.data.user) onSuccess(event.data);
    };
    window.addEventListener('message', receive);
    const timer = window.setInterval(() => { if (popup.closed) { finish(); } }, 500);
    const timeout = window.setTimeout(() => { finish(); onError('Sign-in expired. Please try again.'); }, 10 * 60 * 1000);
    cleanup.current = () => { window.removeEventListener('message', receive); clearInterval(timer); clearTimeout(timeout); if (!popup.closed) popup.close(); cleanup.current = () => {}; };
  };
  return <div className="auth-social">
    <div className="auth-or"><span>Or</span></div>
    <div className="auth-social-buttons">{['google', 'discord'].map(provider => <button key={provider} type="button" className="auth-provider-button" disabled={busy} onClick={() => start(provider)}><ProviderLogo provider={provider}/><span>Continue with {provider === 'google' ? 'Google' : 'Discord'}</span></button>)}</div>
    {busy && <p role="status">Complete sign-in in the popup window.</p>}
  </div>;
}
