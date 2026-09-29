import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { supportRequest } from '../api/support';
import { authStorage } from '../utils/authStorage';
import { getStoredUser, hasValidSession } from '../utils/authSession';
import { formatChatDateDivider, shouldRenderDateDivider } from '../utils/chatDates';
import { loadSupportMessageTarget, supportAdminDestination } from '../utils/supportMessageLink';
import '../styles/SupportChat.css';

export function SupportIcon({ type = 'chat' }) {
    const paths = { chat: 'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H6l-4 2V11.5A8.5 8.5 0 0 1 10.5 3h2a8.5 8.5 0 0 1 8.5 8.5ZM7 10h9M7 14h6', close: 'm6 6 12 12M6 18 18 6', send: 'm4 11 8-8 8 8M12 3v18', attach: 'm8 13 7-7a3 3 0 0 1 4 4L9 20a5 5 0 0 1-7-7L13 2M5 15l10-10', back: 'm14 5-7 7 7 7', file: 'M14 2H5v20h14V7l-5-5ZM14 2v6h5M8 13h8M8 17h6', bolt: 'm13 2-8 12h6l-1 8 9-13h-7l1-7' };
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[type] || paths.chat} /></svg>;
}
export function SupportAvatar({ user }) {
    const name = user?.username || user?.profile?.displayName || 'Support';
    return <span className="support-avatar">{user?.profile?.profileImageUrl ? <img src={user.profile.profileImageUrl} alt="" /> : name.slice(0, 1).toUpperCase()}</span>;
}
const nameOf = user => user?.username || user?.profile?.displayName || 'Support';
const mergeMessages = (old, fresh) => [...new Map([...old, ...fresh].map(m => [m.id, m])).values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

export function SupportConversation({ threadId, user, active = true, online = null, targetMessageId = null }) {
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [hasMore, setHasMore] = useState(false);
    const [focusMessageId, setFocusMessageId] = useState(null);
    const [error, setError] = useState('');
    const [connectionError, setConnectionError] = useState('');
    const [text, setText] = useState('');
    const [file, setFile] = useState(null);
    const [sending, setSending] = useState(false);
    const [olderBusy, setOlderBusy] = useState(false);
    const scroll = useRef(null);
    const input = useRef(null);
    const pinned = useRef(true);
    const retryId = useRef(null);
    const lastRead = useRef(null);
    const initialPage = useRef(true);
    const targetElement = useRef(null);
    const targetPositioned = useRef(false);
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

    useEffect(() => {
        if (!active) return;
        let stopped = false;
        let timer;
        const poll = async () => {
            try {
                if (!document.hidden) {
                    const data = initialPage.current
                        ? await loadSupportMessageTarget(supportRequest, threadId, targetMessageId, () => stopped)
                        : await supportRequest(`/threads/${threadId}/messages`);
                    if (stopped) return;
                    setMessages(old => mergeMessages(old, data.messages));
                    if (initialPage.current) { setHasMore(data.hasMore); setFocusMessageId(data.focusMessageId); initialPage.current = false; }
                    setConnectionError('');
                }
            } catch (err) { if (!stopped) setConnectionError(err.message); }
            finally { if (!stopped) { setLoading(false); timer = setTimeout(poll, 3000); } }
        };
        void poll();
        return () => { stopped = true; clearTimeout(timer); };
    }, [threadId, active, targetMessageId]);

    useEffect(() => {
        if (!active || !messages.length || document.hidden) return;
        if (focusMessageId && !targetPositioned.current) {
            const element = targetElement.current;
            if (!element || !scroll.current) return;
            targetPositioned.current = true;
            pinned.current = false;
            const container = scroll.current;
            const bounds = element.getBoundingClientRect();
            const viewport = container.getBoundingClientRect();
            if (bounds.top < viewport.top || bounds.bottom > viewport.bottom) {
                container.scrollTop += bounds.top - viewport.top - Math.max(12, (container.clientHeight - bounds.height) / 2);
            }
            element.focus({ preventScroll: true });
            element.classList.add('support-message-highlight');
        } else if (pinned.current) {
            scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'instant' });
        }
        const id = pinned.current ? messages.at(-1).id : focusMessageId;
        if (id && lastRead.current !== id) {
            lastRead.current = id;
            supportRequest(`/threads/${threadId}/read`, { method: 'POST', body: { messageId: id } })
                .then(() => window.dispatchEvent(new Event('support:read')))
                .catch(() => { lastRead.current = null; });
        }
    }, [messages, active, threadId, focusMessageId]);

    async function loadOlder() {
        setOlderBusy(true);
        const previousHeight = scroll.current?.scrollHeight || 0;
        try {
            const data = await supportRequest(`/threads/${threadId}/messages?before=${messages[0].id}`);
            if (!mounted.current) return;
            pinned.current = false;
            setMessages(old => mergeMessages(old, data.messages));
            setHasMore(data.hasMore);
            requestAnimationFrame(() => { if (scroll.current) scroll.current.scrollTop += scroll.current.scrollHeight - previousHeight; });
        } catch (err) { if (mounted.current) setError(err.message); }
        finally { if (mounted.current) setOlderBusy(false); }
    }
    async function send(event) {
        event.preventDefault();
        if (sending || (!text.trim() && !file)) return;
        setSending(true); setError('');
        retryId.current ||= crypto.randomUUID();
        const body = new FormData();
        body.append('text', text.trim()); body.append('clientId', retryId.current);
        if (file) body.append('attachment', file);
        try {
            const result = await supportRequest(`/threads/${threadId}/messages`, { method: 'POST', body });
            if (!mounted.current) return;
            pinned.current = true;
            setMessages(old => mergeMessages(old, [result.message]));
            setText(''); setFile(null); retryId.current = null;
        } catch (err) { if (mounted.current) setError(err.message); }
        finally { if (mounted.current) setSending(false); }
    }
    async function openAttachment(message) {
        try {
            const { url } = await supportRequest(`/attachments/${message.id}`);
            window.open(url, '_blank', 'noopener,noreferrer');
        } catch (err) { setError(err.message || 'Failed to open attachment.'); }
    }
    return <div className="support-conversation">
        <div className="support-messages" ref={scroll} role="log" aria-label="Support messages" aria-live="polite" onScroll={() => { const el = scroll.current; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
            {hasMore && <button className="support-older" onClick={loadOlder} disabled={olderBusy}>{olderBusy ? 'Loading…' : 'Earlier messages'}</button>}
            {loading && <p className="support-muted">Loading your conversation…</p>}
            {!loading && !messages.length && <div className="support-welcome"><span className="support-welcome-icon"><SupportIcon /></span><h3>A little help. A better game.</h3><p>Ask about an order, a service, or your account. We’re here to help.</p><div className="support-prompts">{['Help with my order', 'Choosing a service'].map(prompt => <button key={prompt} onClick={() => { setText(prompt); retryId.current = null; }}>{prompt}<span>↗</span></button>)}</div></div>}
            {messages.map((message, index) => <Fragment key={message.id}>
                {shouldRenderDateDivider(messages[index - 1], message) && <div className="support-date-divider"><span>{formatChatDateDivider(message.createdAt)}</span></div>}
                <article ref={message.id === focusMessageId ? targetElement : null} tabIndex={message.id === focusMessageId ? -1 : undefined} onAnimationEnd={event => { if (event.target === event.currentTarget) event.currentTarget.classList.remove('support-message-highlight'); }} className={`support-message ${message.senderId === user.id ? 'mine' : ''} ${message.id === focusMessageId ? 'support-message-target' : ''}`}>
                {message.senderId !== user.id && <SupportAvatar user={message.sender} />}
                <div>
                    <span className="support-sender">{message.senderId === user.id ? 'You' : nameOf(message.sender)}</span>
                    {message.content && <div className="support-bubble"><p>{message.content}</p></div>}
                    {message.attachmentName && <button className="support-file" onClick={() => openAttachment(message)}><SupportIcon type="file" /><span>{message.attachmentName}<small>{Math.max(1, Math.round(message.attachmentSize / 1024))} KB · Open attachment</small></span><span>↗</span></button>}
                    <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                </div>
            </article></Fragment>)}
        </div>
        {online === false && <p className="support-offline-note">No one is online. Leave a message and we’ll follow up.</p>}
        {error && <p role="alert" className="support-error">{error}</p>}
        {connectionError && <p role="status" className="support-error">{connectionError} Reconnecting…</p>}
        <form className="support-composer" onSubmit={send}>
            {file && <div className="support-selected-file"><SupportIcon type="file" /><span>{file.name}</span><button type="button" aria-label="Remove attachment" disabled={sending} onClick={() => { setFile(null); retryId.current = null; }}>×</button></div>}
            <textarea aria-label="Message to support" placeholder="Write a message…" maxLength={4000} rows={2} value={text} disabled={sending} onChange={e => { setText(e.target.value); retryId.current = null; }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(e); } }} />
            <div className="support-composer-actions"><input type="file" hidden ref={input} accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.doc,.docx,.xls,.xlsx,.zip" onChange={e => { const selected = e.target.files?.[0]; e.target.value = ''; if (!selected) return; if (selected.size > 10 * 1024 * 1024) { setError('Choose a file up to 10 MB.'); return; } setFile(selected); setError(''); retryId.current = null; }} /><button type="button" className="support-icon-button" aria-label="Attach a file" title="Attach a file up to 10 MB" disabled={sending} onClick={() => input.current?.click()}><SupportIcon type="attach" /></button><small>Files up to 10 MB</small><button className="support-send" type="submit" aria-label={sending ? 'Sending message' : 'Send message'} disabled={sending || (!text.trim() && !file)}>{sending ? <span className="support-spinner" /> : <SupportIcon type="send" />}</button></div>
        </form>
    </div>;
}

function AdminAvailability() {
    const location = useLocation();
    const [error, setError] = useState(false);
    const [unread, setUnread] = useState(false);
    useEffect(() => {
        const sessionId = crypto.randomUUID();
        const token = authStorage.getItem('token');
        let queue = Promise.resolve();
        const update = () => {
            const hidden = document.hidden;
            queue = queue.catch(() => {}).then(async () => {
                await supportRequest(hidden ? `/presence/${sessionId}` : '/presence', { method: hidden ? 'DELETE' : 'POST', token, body: hidden ? undefined : { sessionId } });
                if (!hidden) { const data = await supportRequest('/threads', { token }); setUnread(data.threads.some(t => t.unread ?? (t.messages[0]?.senderId === t.customerId && t.messages[0].createdAt > t.adminReadAt))); }
            }).then(() => setError(false)).catch(() => setError(true));
        };
        update();
        const timer = setInterval(update, 15000);
        document.addEventListener('visibilitychange', update);
        return () => { clearInterval(timer); document.removeEventListener('visibilitychange', update); queue.finally(() => supportRequest(`/presence/${sessionId}`, { method: 'DELETE', token }).catch(() => {})); };
    }, []);
    if (location.pathname === '/admin/support') return null;
    return <Link className={`support-admin-launcher ${error ? 'unavailable' : ''}`} to="/admin/support"><SupportIcon /><span>{error ? 'Support reconnecting' : unread ? 'New support message' : 'Support inbox'}</span><i aria-label={unread ? 'Unread support message' : 'Support availability'} /></Link>;
}

function CustomerSupport({ user }) {
    const [open, setOpen] = useState(false);
    const [admins, setAdmins] = useState(null);
    const [thread, setThread] = useState(null);
    const [error, setError] = useState('');
    const [unread, setUnread] = useState(false);
    const trigger = useRef(null);
    const closeButton = useRef(null);
    const [footerHeight, setFooterHeight] = useState(0);
    const location = useLocation();
    const targetMessageId = new URLSearchParams(location.search).get('message');
    useEffect(() => {
        if (location.pathname === '/support') setOpen(true);
    }, [location.pathname, user]);
    useEffect(() => {
        if (user && new URLSearchParams(location.search).get('support') === 'open') setOpen(true);
    }, [location.key, location.search, user]);
    useEffect(() => {
        const observer = new ResizeObserver(() => setFooterHeight(document.querySelector('.sale-footer-dock')?.getBoundingClientRect().height || 0));
        observer.observe(document.body);
        const footer = document.querySelector('.sale-footer-dock');
        if (footer) observer.observe(footer);
        setFooterHeight(footer?.getBoundingClientRect().height || 0);
        return () => observer.disconnect();
    }, [location.pathname]);
    useEffect(() => {
        if (!user) return;
        let stopped = false;
        let timer;
        const poll = async () => {
            try {
                if (!document.hidden) {
                    const data = await supportRequest('/status');
                    if (stopped) return;
                    setAdmins(data.admins);
                    if (thread && !open) {
                        const data = await supportRequest(`/threads/${thread.id}/messages`);
                        if (!stopped) setUnread(data.messages.some(m => m.senderId !== user.id && m.createdAt > data.thread.customerReadAt));
                    }
                }
            } catch { if (!stopped) setAdmins(null); }
            finally { if (!stopped) timer = setTimeout(poll, 10000); }
        };
        void poll();
        return () => { stopped = true; clearTimeout(timer); };
    }, [user, thread, open]);
    useEffect(() => {
        if (!user || thread) return;
        let stopped = false;
        supportRequest('/thread', { method: 'POST' }).then(data => { if (!stopped) { setThread(data.thread); setError(''); } }).catch(err => { if (!stopped) setError(err.message); });
        return () => { stopped = true; };
    }, [open, user, thread]);
    useEffect(() => { if (open) { closeButton.current?.focus(); setUnread(false); } }, [open]);
    const close = () => { setOpen(false); requestAnimationFrame(() => trigger.current?.focus()); };
    const online = admins === null ? null : admins.length > 0;
    return <div className="support-widget" style={{ '--support-bottom': `${footerHeight + 20}px` }}>
        <section className={`support-panel ${open ? 'is-open' : ''}`} inert={!open} aria-hidden={!open} role="dialog" aria-label="FastBoost support chat" onKeyDown={e => { if (e.key === 'Escape') close(); }}>
            <header className="support-header"><div><span className="support-eyebrow">FASTBOOST SUPPORT</span><h2>Let’s talk<span> ✦</span></h2></div><button ref={closeButton} className="support-icon-button" aria-label="Close support chat" onClick={close}><SupportIcon type="close" /></button></header>
            {user ? <><div className="support-presence"><div className="support-avatar-stack">{admins?.length ? admins.slice(0, 3).map(admin => <SupportAvatar key={admin.id} user={admin} />) : <span className="support-team-icon"><SupportIcon /></span>}</div><div><strong>{admins?.length ? admins.map(nameOf).join(', ') : 'Your support team'}</strong><span><i className={online ? 'online' : ''} />{online === null ? 'Checking availability…' : online ? 'Online · Ready to help' : 'No one is online'}</span></div></div>{thread ? <SupportConversation key={`${thread.id}:${targetMessageId || ""}`} threadId={thread.id} targetMessageId={targetMessageId} user={user} active={open} online={online} /> : <div className="support-welcome">{error ? <><p role="alert">{error}</p><button className="support-primary" onClick={() => { setOpen(false); trigger.current?.focus(); }}>Close and try again</button></> : <p>Opening your conversation…</p>}</div>}</> : <div className="support-signin"><span className="support-welcome-icon"><SupportIcon /></span><h3>A helping hand, right here.</h3><p>Sign in to message our team and keep your conversation in one place.</p><Link className="support-primary" to={location.pathname === '/support' ? '/support' + location.search : '/'} state={{ openAuthModal: true, authMode: 'login' }} onClick={() => setOpen(false)}>Sign in to chat <span>↗</span></Link><Link to="/faq" onClick={() => setOpen(false)}>Browse quick answers</Link></div>}
            <div className="support-brandline"><SupportIcon type="bolt" /> A little boost goes a long way.</div>
        </section>
        <button ref={trigger} className="support-launcher" hidden={open} aria-label="Open support chat" aria-expanded={open} onClick={() => setOpen(true)}><SupportIcon /><span>Need a hand?</span>{unread && <i className="support-unread" aria-label="Unread support message" />}</button>
    </div>;
}

export default function SupportChat() {
    const location = useLocation();
    const [session, setSession] = useState(() => ({ user: hasValidSession() ? getStoredUser() : null, token: authStorage.getItem('token') }));
    useEffect(() => {
        const update = () => setSession({ user: hasValidSession() ? getStoredUser() : null, token: authStorage.getItem('token') });
        window.addEventListener('auth:changed', update); window.addEventListener('storage', update); window.addEventListener('session:expired', update);
        const timer = setInterval(() => { if (!hasValidSession()) setSession(old => old.user ? { user: null, token: null } : old); }, 30000);
        return () => { clearInterval(timer); window.removeEventListener('auth:changed', update); window.removeEventListener('storage', update); window.removeEventListener('session:expired', update); };
    }, []);
    if (session.user?.role === 'ADMIN' && location.pathname === '/support') return <Navigate to={supportAdminDestination(location.search)} replace />;
    if (session.user?.role === 'ADMIN') return <AdminAvailability key={session.token} />;
    if (session.user && session.user.role !== 'CUSTOMER') return null;
    return <CustomerSupport key={session.token || 'guest'} user={session.user} />;
}
