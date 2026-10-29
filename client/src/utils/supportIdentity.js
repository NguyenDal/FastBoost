const text = value => typeof value === 'string' ? value.trim() : '';

export function supportIdentityName(user, fallbackRole = 'CUSTOMER') {
    return text(user?.username) || text(user?.profile?.displayName)
        || ((user?.role || fallbackRole) === 'ADMIN' ? 'Support' : 'Customer');
}

export function supportIdentityHasName(user) {
    return Boolean(text(user?.username) || text(user?.profile?.displayName));
}

export function supportIdentityImage(user) {
    return text(user?.profile?.profileImageUrl) || text(user?.profileImageUrl) || text(user?.profileImage) || null;
}
