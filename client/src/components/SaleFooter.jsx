import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { API_BASE_URL } from "../api/config";
import "../styles/SaleFooter.css";

function CouponCode({ code }) {
    const [feedback, setFeedback] = useState("");
    useEffect(() => {
        if (!feedback) return;
        const timeout = setTimeout(() => setFeedback(""), 2500);
        return () => clearTimeout(timeout);
    }, [feedback]);
    const copyCode = async () => {
        try {
            await navigator.clipboard.writeText(code);
            setFeedback("Copied!");
        } catch {
            setFeedback("Copy code manually");
        }
    };
    return <span className="sale-footer-coupon">
        <span>Use code</span>
        <button type="button" className="sale-footer-copy" onClick={copyCode} aria-label={`Copy coupon code ${code}`} title="Copy code to use at checkout">
            <b>{code}</b>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></svg>
        </button>
        <span className="sale-footer-copy-feedback" role="status">{feedback}</span>
    </span>;
}

export function SaleBanner({ promotion, now, preview = false }) {
    const [clock, setClock] = useState(Date.now);
    useEffect(() => {
        if (now !== undefined) return;
        const tick = setInterval(() => setClock(Date.now()), 1000);
        return () => clearInterval(tick);
    }, [now]);
    const currentTime = now ?? clock;
    if (!promotion) return null;
    const end = promotion.endsAt ? new Date(promotion.endsAt).getTime() : null;
    if (end !== null && (!Number.isFinite(end) || end <= currentTime)) return null;
    const timer = promotion.footerTimer !== false && end !== null;
    const seconds = timer ? Math.max(0, Math.ceil((end - currentTime) / 1000)) : 0;
    const parts = [Math.floor(seconds / 86400), Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60];
    return <aside className={`sale-footer-bar${timer ? "" : " sale-footer-no-timer"}${preview ? " sale-footer-preview" : ""}`} aria-label="Current sale">
        <strong className="sale-footer-title">{promotion.title}</strong>
        <div className="sale-footer-offer">
            <span className="sale-footer-discount">{Number(promotion.discountPercent)}% OFF {promotion.scope === "GLOBAL" ? "ALL SERVICES" : promotion.service?.title || "THIS SERVICE"}</span>
            {promotion.couponCode && <CouponCode key={promotion.couponCode} code={promotion.couponCode} />}
        </div>
        {timer && <div className="sale-footer-timer" role="timer" aria-label="Time until sale ends">
            {parts.map((value, index) => <span className="sale-footer-time" key={index}><b>{String(value).padStart(2, "0")}</b><small>{["DAYS", "HRS", "MIN", "SEC"][index]}</small></span>)}
        </div>}
    </aside>;
}

export function LiveSaleFooter({ serviceId }) {
    const [promotion, setPromotion] = useState(null);
    const [now, setNow] = useState(Date.now);
    const [height, setHeight] = useState(0);
    const bar = useRef(null);
    useEffect(() => {
        let alive = true;
        let pending = false;
        const controller = new AbortController();
        const refresh = async () => {
            if (pending || document.hidden) return;
            pending = true;
            try {
                const response = await fetch(`${API_BASE_URL}/pricing/footer-promotion${serviceId ? `?serviceId=${encodeURIComponent(serviceId)}` : ""}`, { signal: controller.signal });
                if (!response.ok) throw new Error("Unavailable");
                const data = await response.json();
                if (alive) setPromotion(data.ok ? data.promotion : null);
            } catch {
                if (alive) setPromotion(null);
            } finally { pending = false; }
        };
        refresh();
        const poll = setInterval(refresh, 30000);
        window.addEventListener("focus", refresh);
        document.addEventListener("visibilitychange", refresh);
        return () => {
            alive = false; controller.abort(); clearInterval(poll);
            window.removeEventListener("focus", refresh);
            document.removeEventListener("visibilitychange", refresh);
        };
    }, [serviceId]);
    useEffect(() => {
        const tick = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(tick);
    }, []);
    useEffect(() => {
        const observer = new ResizeObserver(([entry]) => setHeight(entry.target.getBoundingClientRect().height));
        observer.observe(bar.current);
        return () => observer.disconnect();
    }, []);
    return <div style={{ height }}>
        <div ref={bar} className="sale-footer-dock"><SaleBanner promotion={promotion} now={now} /></div>
    </div>;
}

export default function SaleFooter() {
    const { pathname } = useLocation();
    const order = pathname.match(/^\/order\/([^/]+)\/?$/);
    const visible = pathname === "/" || pathname === "/contact" || /^\/r\/[^/]+\/?$/.test(pathname) || order;
    return visible ? <LiveSaleFooter key={pathname} serviceId={order?.[1]} /> : null;
}
