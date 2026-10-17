const userId = user => user?.id ?? user?.userId ?? user?._id ?? user?.sub ?? null;
const firstText = (...values) => values.find(value => typeof value === 'string' && value.trim())?.trim();

function conversationUsers(conversation) {
    if (!Array.isArray(conversation?.participants)) return [];
    return conversation.participants.filter(Boolean).map(participant => {
        const user = participant.user || participant.booster || participant.provider || participant.participant || participant;
        const id = userId(user) ?? participant.userId ?? participant.boosterId ?? participant.providerId;
        return id == null ? user : { ...user, id };
    });
}

function withParticipantProfile(assigned, participants, assignmentId) {
    if (!assigned && assignmentId == null) return null;
    const id = assignmentId ?? userId(assigned);
    const participant = id == null ? null : participants.find(user => String(userId(user)) === String(id));
    const booster = { ...participant, ...assigned, ...(id == null ? {} : { id }) };
    if (assigned?.profile && typeof assigned.profile === 'object') {
        booster.profile = { ...participant?.profile, ...assigned.profile };
    }
    // A saved null profile or image remains authoritative; do not resurrect it
    // from an older conversation snapshot. Missing fields can still be enriched.
    return booster;
}

export function findAssignedBooster(conversation, order) {
    const participants = conversationUsers(conversation);
    const hasAssignments = Boolean(order && (Object.hasOwn(order, 'assignments') || Object.hasOwn(order, 'orderAssignments')));
    const assignments = Array.isArray(order?.assignments) ? order.assignments
        : Array.isArray(order?.orderAssignments) ? order.orderAssignments : [];
    for (const assignment of assignments) {
        if (!assignment) continue;
        const user = assignment.booster || assignment.user || assignment.provider;
        const id = assignment.boosterId ?? assignment.userId ?? assignment.providerId ?? userId(user);
        const booster = withParticipantProfile(user, participants, id);
        if (booster) return booster;
    }
    const legacy = order?.booster || order?.provider || order?.assignedBooster || order?.assignedProvider;
    if (legacy) return withParticipantProfile(legacy, participants);
    if (hasAssignments) return null;
    return participants.find(user => ['PROVIDER', 'BOOSTER'].includes(String(user?.role || '').toUpperCase())
        || user?.hasBoosterAccess === true) || null;
}

export function getBoosterDisplayName(booster) {
    return firstText(booster?.profile?.displayName, booster?.displayName, booster?.username, booster?.name, booster?.email)
        || 'Assigned Booster';
}

export function getBoosterAvatar(booster) {
    return firstText(booster?.profile?.profileImageUrl, booster?.profileImageUrl,
        booster?.profileImage, booster?.avatar, booster?.photoUrl,
        booster?.profile?.profileImage, booster?.profile?.avatar, booster?.profile?.photoUrl)
        || `https://ui-avatars.com/api/?name=${encodeURIComponent(getBoosterDisplayName(booster))}&background=111827&color=fff`;
}
