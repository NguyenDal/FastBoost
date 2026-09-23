import { useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../api/config';
import { authStorage } from '../utils/authStorage';
import { ProviderLogo } from './SocialAuthButtons';
import PaymentErrorDialog from './PaymentErrorDialog';

async function getConnections(signal) {
  const response = await fetch(`${API_BASE_URL}/auth/social/connections`, {
    headers: { Authorization: `Bearer ${authStorage.getItem('token')}` }, signal,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load linked accounts.');
  return data;
}

export default function LinkedSignInAccounts() {
  const [connections, setConnections] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const cleanup = useRef(() => {});
  useEffect(() => {
    const controller = new AbortController();
    getConnections(controller.signal).then(setConnections).catch(error => {
      if (!controller.signal.aborted) setError(error.message);
    });
    return () => { controller.abort(); cleanup.current(); };
  }, []);

  const startAccountAction = (provider, action) => {
    const sessionToken = authStorage.getItem('token');
    if (!sessionToken) { setError('Please sign in again.'); return; }
    cleanup.current();
    const url = new URL(`${API_BASE_URL}/auth/social/${provider}/${action}/start`, window.location.origin);
    const popup = window.open('about:blank', 'fastboost-link-auth', 'popup,width=520,height=720');
    if (!popup) { setError('Please allow the sign-in popup and try again.'); return; }
    setBusy({ provider, action }); setError('');
    const finish = () => { cleanup.current(); setBusy(null); };
    const receive = event => {
      if (event.origin !== url.origin || event.source !== popup || event.data?.type !== 'fastboost:social-auth') return;
      finish();
      if (authStorage.getItem('token') !== sessionToken) return;
      if (event.data.error) { setError(event.data.error); return; }
      if (event.data[action === 'unlink' ? 'unlinked' : 'linked'] === provider) {
        setConnections(previous => ({ ...previous, [provider]: { ...previous?.[provider], linked: action === 'link' } }));
      }
    };
    window.addEventListener('message', receive);
    const timer = window.setInterval(() => { if (popup.closed) finish(); }, 500);
    const timeout = window.setTimeout(() => { finish(); setError('Account verification expired. Please try again.'); }, 10 * 60 * 1000);
    cleanup.current = () => {
      window.removeEventListener('message', receive); clearInterval(timer); clearTimeout(timeout);
      if (!popup.closed) popup.close(); cleanup.current = () => {};
    };
    // Form POST sets the API's OAuth cookie through a top-level popup navigation.
    // The session credential stays out of URLs, browser history and referrers.
    const form = document.createElement('form');
    form.method = 'POST'; form.action = url.toString(); form.target = 'fastboost-link-auth'; form.hidden = true;
    for (const [name, value] of Object.entries({ sessionToken, origin: window.location.origin })) {
      const input = document.createElement('input'); input.type = 'hidden'; input.name = name; input.value = value; form.append(input);
    }
    document.body.append(form);
    try { form.submit(); }
    catch { finish(); setError('Could not open account verification. Please try again.'); }
    finally { form.remove(); }
  };

  return <fieldset className="settings-linked-accounts">
    <legend>Linked accounts</legend>
    <div className="settings-linked-grid">
      {['google', 'discord'].map(provider => {
        const connection = connections?.[provider];
        const name = provider === 'google' ? 'Google' : 'Discord';
        return <div className="settings-linked-provider" key={provider}>
          <ProviderLogo provider={provider}/>
          <div><strong>{name}</strong><span className={connection?.linked ? 'is-linked' : undefined}>{connection?.linked ? 'Linked' : !connections ? 'Loading...' : connection?.configured ? 'Not linked' : 'Not available yet'}</span></div>
          <button type="button" aria-label={connection?.linked ? `Unlink ${name}` : undefined} disabled={Boolean(busy) || !connection?.configured} onClick={() => startAccountAction(provider, connection?.linked ? 'unlink' : 'link')}>
            {busy?.provider === provider ? busy.action === 'unlink' ? 'Unlinking...' : 'Linking...' : connection?.linked ? 'Unlink' : `Link ${name}`}
          </button>
        </div>;
      })}
    </div>
    {error && <PaymentErrorDialog warning eyebrow="" title="" message={error} action="OK" onClose={() => setError('')} />}
  </fieldset>;
}
