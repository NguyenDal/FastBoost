import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supportRequest } from '../api/support';
import { getStoredUser } from '../utils/authSession';
import { SupportAvatar, SupportConversation, SupportIcon } from '../components/SupportChat';

export default function AdminSupportPage() {
    const [params, setParams] = useSearchParams();
    const selected = params.get('thread');
    const [threads, setThreads] = useState([]);
    const [hasMore, setHasMore] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [moreBusy, setMoreBusy] = useState(false);
    const loadedMore = useRef(false);
    const user = getStoredUser();
    useEffect(() => {
        let stopped = false;
        let timer;
        const refresh = async () => {
            try {
                if (!document.hidden) {
                    const data = await supportRequest('/threads');
                    if (stopped) return;
                    setThreads(old => [...data.threads, ...old.filter(t => !data.threads.some(fresh => fresh.id === t.id))]);
                    if (!loadedMore.current) setHasMore(data.hasMore);
                    setError('');
                }
            } catch (err) { if (!stopped) setError(err.message); }
            finally { if (!stopped) { setLoading(false); timer = setTimeout(refresh, 5000); } }
        };
        void refresh();
        return () => { stopped = true; clearTimeout(timer); };
    }, []);
    async function more() {
        setMoreBusy(true);
        try {
            const data = await supportRequest(`/threads?offset=${threads.length}`);
            loadedMore.current = true;
            setThreads(old => [...old, ...data.threads.filter(t => !old.some(existing => existing.id === t.id))]); setHasMore(data.hasMore);
        } catch (err) { setError(err.message); }
        finally { setMoreBusy(false); }
    }
    const active = threads.find(thread => thread.id === selected);
    return <div className="support-admin-page"><div className="support-admin-title"><div><span className="support-eyebrow">CUSTOMER CARE</span><h1>Support inbox</h1></div><p><i className="support-status-dot" />You’re available while this tab is visible</p></div>
        {error && <p className="support-error" role="alert">{error}</p>}
        <div className={`support-inbox ${selected ? 'has-selection' : ''}`}>
            <aside className="support-thread-list" aria-label="Customer conversations"><h2>Conversations</h2>{loading && <p className="support-muted">Loading inbox…</p>}{!loading && !threads.length && <div className="support-empty"><SupportIcon /><p>All quiet for now.</p><small>Customer messages will appear here.</small></div>}{threads.map(thread => {
                const message = thread.messages[0];
                const unread = message?.sender.role === 'CUSTOMER' && message.createdAt > thread.adminReadAt;
                return <button key={thread.id} className={`support-thread ${selected === thread.id ? 'selected' : ''}`} aria-pressed={selected === thread.id} onClick={() => setParams({ thread: thread.id })}><SupportAvatar user={thread.customer} /><span><strong>{thread.customer.username || thread.customer.profile?.displayName || 'Customer'}</strong><small>{message?.content || message?.attachmentName || 'New conversation'}</small></span>{unread && <i className="support-unread-dot" aria-label="Unread" />}</button>;
            })}{hasMore && <button className="support-older" onClick={more} disabled={moreBusy}>{moreBusy ? 'Loading…' : 'More conversations'}</button>}</aside>
            <section className="support-inbox-conversation" aria-label="Selected conversation">{selected ? <><header className="support-inbox-header"><button className="support-icon-button" aria-label="Back to conversations" onClick={() => setParams({})}><SupportIcon type="back" /></button><SupportAvatar user={active?.customer} /><div><strong>{active?.customer.username || active?.customer.profile?.displayName || 'Customer'}</strong><small>Private support conversation</small></div></header><SupportConversation key={selected} threadId={selected} user={user} /></> : <div className="support-empty"><span className="support-welcome-icon"><SupportIcon /></span><h2>Every conversation starts here.</h2><p>Choose a customer to read their messages and reply.</p></div>}</section>
        </div>
    </div>;
}
