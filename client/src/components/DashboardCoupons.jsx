import "../styles/SaleFooter.css";
import DashboardIcon from "./DashboardIcon";
import { useEffect, useState } from 'react';
import { authStorage } from '../utils/authStorage';
import { API_BASE_URL } from '../api/config';
function CouponCountdown({ coupon, now }) {
 const scheduled = coupon.startsAt && new Date(coupon.startsAt).getTime() > now;
 const target = scheduled ? coupon.startsAt : coupon.endsAt;
 if (coupon.used) return <small>Used</small>;
 if (!target) return <small>No expiration</small>;
 const seconds = Math.max(0, Math.ceil((new Date(target).getTime() - now) / 1000));
 if (!seconds) return <small>Expired</small>;
 const parts = [Math.floor(seconds / 86400), Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60];
 return <div className="sale-footer-timer dashboard-coupon-countdown" role="timer" aria-label={scheduled ? 'Time until coupon starts' : 'Time until coupon ends'}>
  {parts.map((value,index)=><span className="sale-footer-time" key={index}><b>{String(value).padStart(2,'0')}</b><small>{['DAYS','HRS','MIN','SEC'][index]}</small></span>)}
 </div>;
}
export default function DashboardCoupons(){
 const [now, setNow] = useState(Date.now);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 const [coupons,setCoupons]=useState([]);const [status,setStatus]=useState('Loading coupons…');const [copied,setCopied]=useState('');
 useEffect(()=>{let alive=true;const load=async()=>{try{const r=await fetch(API_BASE_URL+'/pricing/my-coupons',{headers:{Authorization:'Bearer '+authStorage.getItem('token')}});const d=await r.json();if(!r.ok)throw Error();if(alive){setCoupons(d.coupons);setStatus(d.coupons.length?'':'No coupons available yet.');}}catch{if(alive)setStatus('Unable to load coupons.');}};load();const timer=setInterval(load,30000);window.addEventListener('focus',load);return()=>{alive=false;clearInterval(timer);window.removeEventListener('focus',load);};},[]);
 useEffect(()=>{if(!copied)return;const timer=setTimeout(()=>setCopied(''),2500);return()=>clearTimeout(timer);},[copied]);
 return <section className="dashboard-card dashboard-coupons-card"><div className="dashboard-activity-header"><DashboardIcon kind="coupon"/><h2>My Coupons</h2><span className="dashboard-coupon-count">{coupons.filter(c=>!c.used&&(!c.endsAt||new Date(c.endsAt).getTime()>now)).length}</span></div><div className="dashboard-coupon-viewport">{status&&<div className="dashboard-coupon-empty" role="status"><DashboardIcon kind="coupon"/><strong>{status}</strong><span>Global, service and personal coupons appear here.</span></div>}<div className="dashboard-coupon-list">{coupons.map(c=>{const scheduled=c.startsAt&&new Date(c.startsAt).getTime()>now;return <article className="dashboard-coupon-row" key={c.id}>
 <div className="dashboard-coupon-ticket" aria-label={c.discountPercent+' percent off'}><svg viewBox="0 0 60 38" aria-hidden="true"><path d="M4 3H56Q58 3 58 5V12Q51 12 51 19Q51 26 58 26V33Q58 35 56 35H4Q2 35 2 33V26Q9 26 9 19Q9 12 2 12V5Q2 3 4 3Z"/><path className="dashboard-ticket-perforation" d="M17 5V33"/><text x="35" y="18" textAnchor="middle" className="dashboard-ticket-percent">{c.discountPercent}%</text><text x="35" y="28" textAnchor="middle" className="dashboard-ticket-off">OFF</text></svg></div>
 <div className="dashboard-coupon-copy"><button type="button" className="sale-footer-copy dashboard-coupon-code" disabled={c.used || Boolean(c.endsAt && new Date(c.endsAt).getTime() <= now)} aria-label={'Copy coupon code '+c.couponCode} title="Copy code to use at checkout" onClick={async()=>{try{await navigator.clipboard.writeText(c.couponCode);setCopied(c.id);}catch{setCopied('failed');}}}><b>{c.couponCode}</b><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button><small title={c.title}>{c.title}</small><span className="sale-footer-copy-feedback dashboard-coupon-copy-feedback" role="status">{copied===c.id?'Copied!':''}</span></div>
 <div className="dashboard-coupon-meta" title={(c.scope==='GLOBAL'?'All services':c.serviceTitles.join(', '))+' · '+(scheduled?'Starts '+new Date(c.startsAt).toLocaleString():c.endsAt?'Ends '+new Date(c.endsAt).toLocaleString():'No expiration')}><CouponCountdown coupon={c} now={now}/></div>
 </article>;})}</div>{copied==='failed'&&<p role="status">Select and copy the code manually.</p>}</div></section>;
}
