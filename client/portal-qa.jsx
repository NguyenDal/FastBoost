import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import BoosterPortalPage from './src/pages/BoosterPortalPage';
import ProviderOrdersPage from './src/pages/ProviderOrdersPage';
import OrderRating from './src/components/OrderRating';
import './src/index.css';
import './src/styles/Global.css';
import './src/styles/Shared.css';
import './src/styles/Navbar.css';
import './src/styles/Auth.css';
import './src/styles/Layout.css';
import './src/styles/Skeleton.css';

const user = { id: 'synthetic-booster', username: 'TestBooster', role: 'PROVIDER', email: 'booster@example.invalid', profile: { displayName: 'Test Booster' } };
sessionStorage.setItem('token', `qa.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))}.synthetic`);
sessionStorage.setItem('user', JSON.stringify(user));
let rating = null;
const response = body => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
window.fetch = (input, options = {}) => {
    const path = new URL(String(input), location.origin).pathname;
    if (path.endsWith('/user/me')) return response({ ok: true, user });
    if (path.endsWith('/operations/me')) return response({ ok: true, account: user, profile: { startedAt: '2026-01-01' }, contracts: [], earnings: { USD: 12345 }, rating: { average: null, count: 0, available: true } });
    if (path.endsWith('/operations/contributions')) return response({ ok: true, orders: [] });
    if (path.endsWith('/orders/provider/assigned')) return response({ ok: true, items: [], total: 0, page: 1, pageSize: 10 });
    if (path.endsWith('/orders/qa-order/rating')) {
        if (options.method === 'POST') rating = { stars: JSON.parse(options.body).stars, createdAt: new Date().toISOString() };
        return response({ ok: true, rating, eligible: !rating });
    }
    if (path.includes('/api/')) return response({ ok: true, notifications: [], messages: [], unreadCount: 0, unreadMessages: 0, unreadNotifications: 0 });
    return Promise.reject(new Error('QA harness blocked an unexpected request'));
};
if (location.pathname === '/portal-qa.html') history.replaceState(null, '', new URLSearchParams(location.search).get('view') === 'rating' ? '/qa-rating' : '/provider/portal');
createRoot(document.getElementById('root')).render(<BrowserRouter><Routes>
    <Route path="/provider/portal" element={<BoosterPortalPage />} />
    <Route path="/provider/orders" element={<ProviderOrdersPage />} />
    <Route path="/provider/earnings" element={<BoosterPortalPage section="earnings" />} />
    <Route path="/provider/documents" element={<BoosterPortalPage section="documents" />} />
    <Route path="/provider/profile" element={<BoosterPortalPage section="profile" />} />
    <Route path="/qa-rating" element={<main className="page-container"><OrderRating orderId="qa-order" /></main>} />
    <Route path="*" element={<Navigate to="/provider/portal" replace />} />
</Routes></BrowserRouter>);
