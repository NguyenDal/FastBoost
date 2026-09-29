export function shouldRenderDateDivider(previousMessage, currentMessage) {
    if (!currentMessage?.createdAt) return false;
    if (!previousMessage?.createdAt) return true;
    return new Date(previousMessage.createdAt).toDateString() !== new Date(currentMessage.createdAt).toDateString();
}

export function formatChatDateDivider(value) {
    if (!value) return '';
    const messageDate = new Date(value);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (messageDate.toDateString() === today.toDateString()) return 'Today';
    if (messageDate.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return messageDate.toLocaleDateString([], { month: 'short', day: '2-digit', year: 'numeric' });
}
