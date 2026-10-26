export function canOpenChatAttachment(message) {
    return Boolean(message?.id && !message.isUploadingAttachment &&
        (message.attachmentName || message.attachmentKey || message.attachmentUrl));
}
