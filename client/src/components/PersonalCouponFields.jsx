import { useEffect, useRef, useState } from 'react';
import { authStorage } from '../utils/authStorage';
import { API_BASE_URL } from '../api/config';
export default function PersonalCouponFields({form,setForm,services}) {
 const menu=useRef(null);
 const searchInput=useRef(null);
 useEffect(()=>{const close=e=>{if(menu.current&&!menu.current.contains(e.target))menu.current.open=false;};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[]);
 const [query,setQuery]=useState('');const [results,setResults]=useState([]);const [message,setMessage]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  const timer=setTimeout(async()=>{
   if(query.trim().length<2)return;
   try{const r=await fetch(API_BASE_URL+'/admin/prices/customers?q='+encodeURIComponent(query.trim()),{headers:{Authorization:'Bearer '+authStorage.getItem('token')},signal:controller.signal});const d=await r.json();if(!r.ok)throw Error();if(controller.signal.aborted)return;setResults(d.customers);setMessage(d.customers.length?'':'No accounts found. Try a username, display name, or email.');}
   catch{if(!controller.signal.aborted)setMessage('Unable to search accounts.');}
  },250);
  return()=>{clearTimeout(timer);controller.abort();};
 },[query]);
 const recipients=form.recipients||[];
 const matches=results.filter(user=>!recipients.some(account=>account.id===user.id));
 const ids=form.couponServiceIds||[];
 const choices=[...new Map(services.map(s=>[s.serviceId,s.service])).entries()];
 return <div className="personal-coupon-fields">
  <div className="price-modal-field"><span>Services</span><details ref={menu} className="personal-service-select" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();menu.current.open=false;menu.current.querySelector('summary').focus();}}}><summary>{ids.length?ids.length+' selected services':'All services'}</summary>
   <div className="personal-service-menu"><label><input type="checkbox" checked={!ids.length} onChange={()=>setForm(f=>({...f,couponServiceIds:[]}))}/>All services</label>
   {choices.map(([id,service])=><label key={id}><input type="checkbox" checked={ids.includes(id)} onChange={e=>{const next=e.target.checked?[...ids,id]:ids.filter(key=>key!==id);setForm(f=>({...f,couponServiceIds:[...new Set(next)]}));}}/>{service?.title}</label>)}
  </div></details></div>
  <label className="price-modal-field"><span>Search accounts</span><input ref={searchInput} value={query} placeholder="Search username, name or email" autoComplete="off" onChange={e=>{setQuery(e.target.value);setResults([]);setMessage(e.target.value.trim().length>=2?'Searching…':'');}}/></label>
  {matches.length>0 && <ul className="personal-customer-results">{matches.map(user=><li key={user.id}><button type="button" onClick={()=>{setForm(f=>({...f,recipients:(f.recipients||[]).some(account=>account.id===user.id)?f.recipients:[...(f.recipients||[]),user]}));setResults([]);setQuery('');setMessage('');searchInput.current?.focus();}}>{user.profile?.profileImageUrl?<img src={user.profile.profileImageUrl} alt=""/>:<span className="personal-avatar">{(user.profile?.displayName || user.username || user.email)?.[0]?.toUpperCase()}</span>}<span>{user.profile?.displayName || user.username || user.email}<small>{user.username ? "@" + user.username + " · " : ""}{user.email}</small></span></button></li>)}</ul>}
  {message && <p className="personal-search-status" role="status">{message}</p>}
  {recipients.length>0 && <div className="personal-selected-accounts">{recipients.map(user=><button key={user.id} type="button" className="personal-selected-account" aria-label={'Remove selected account '+(user.username||user.email)} title="Remove selected account" onClick={()=>{setForm(f=>({...f,recipients:f.recipients.filter(account=>account.id!==user.id)}));searchInput.current?.focus();}}>
   {user.profile?.profileImageUrl?<img src={user.profile.profileImageUrl} alt=""/>:<span className="personal-avatar">{(user.username||user.email)?.[0]?.toUpperCase()}</span>}
   <span className="personal-selected-identity"><strong>{user.username?'@'+user.username:user.profile?.displayName||user.email}</strong><small>{user.email}</small></span>
   <span className="personal-selected-remove" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg></span>
  </button>)}</div>}
 </div>;
}
