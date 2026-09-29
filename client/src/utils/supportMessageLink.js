// Keep the history continuous when an email points beyond the latest page.
export async function loadSupportMessageTarget(request, threadId, messageId, stopped = () => false) {
    const path = `/threads/${encodeURIComponent(threadId)}/messages`;
    const latest = await request(`${path}?target=${encodeURIComponent(messageId)}`);
    let messages = latest.messages;
    let hasMore = latest.hasMore;
    while (!messages.some(message => message.id === messageId) && hasMore && !stopped()) {
        const before = messages[0]?.id;
        if (!before) break;
        const older = await request(`${path}?before=${encodeURIComponent(before)}`);
        if (!older.messages.length || older.messages[0].id === before) break;
        messages = [...older.messages, ...messages];
        hasMore = older.hasMore;
    }
    if (!stopped() && !messages.some(message => message.id === messageId)) throw new Error('This support message is unavailable.');
    return { ...latest, messages, hasMore };
}

export function supportAdminDestination(search) {
    const params = new URLSearchParams(search);
    const target = new URLSearchParams();
    for (const key of ['thread', 'message']) {
        if (params.get(key)) target.set(key, params.get(key));
    }
    return '/admin/support' + (target.size ? `?${target}` : '');
}
