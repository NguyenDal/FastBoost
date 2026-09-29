// Keep the history continuous when an email points beyond the latest page.
export async function loadSupportMessageTarget(request, threadId, messageId, stopped = () => false) {
    const path = `/threads/${encodeURIComponent(threadId)}/messages`;
    const latest = await request(`${path}?${messageId ? `target=${encodeURIComponent(messageId)}` : 'focus=unread'}`);
    // Prefer the beginning of the unread batch over a later email's message.
    const focusMessageId = latest.firstUnreadMessageId || messageId;
    let messages = latest.messages;
    let hasMore = latest.hasMore;
    while (focusMessageId && !messages.some(message => message.id === focusMessageId) && hasMore && !stopped()) {
        const before = messages[0]?.id;
        if (!before) break;
        const older = await request(`${path}?before=${encodeURIComponent(before)}`);
        if (!older.messages.length || older.messages[0].id === before) break;
        messages = [...older.messages, ...messages];
        hasMore = older.hasMore;
    }
    if (focusMessageId && !stopped() && !messages.some(message => message.id === focusMessageId)) throw new Error('This support message is unavailable.');
    return { ...latest, messages, hasMore, focusMessageId };
}

export function supportAdminDestination(search) {
    const params = new URLSearchParams(search);
    const target = new URLSearchParams();
    for (const key of ['thread', 'message']) {
        if (params.get(key)) target.set(key, params.get(key));
    }
    return '/admin/support' + (target.size ? `?${target}` : '');
}
