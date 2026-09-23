import { useEffect, useRef, useState } from 'react';
import { authStorage } from '../utils/authStorage';
import { API_BASE_URL } from '../api/config';
export default function PersonalCouponFields({form,setForm,services}) {
 const menu=useRef(null);
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
 const ids=form.couponServiceIds||[];
 const choices=[...new Map(services.map(s=>[s.serviceId,s.service])).entries()];
 return <div className="personal-coupon-fields">
  <div className="price-modal-field"><span>Services</span><details ref={menu} className="personal-service-select" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();menu.current.open=false;menu.current.querySelector('summary').focus();}}}><summary>{ids.length?ids.length+' selected services':'All services'}</summary>
   <div className="personal-service-menu"><label><input type="checkbox" checked={!ids.length} onChange={()=>setForm(f=>({...f,couponServiceIds:[]}))}/>All services</label>
   {choices.map(([id,service])=><label key={id}><input type="checkbox" checked={ids.includes(id)} onChange={e=>{const next=e.target.checked?[...ids,id]:ids.filter(key=>key!==id);setForm(f=>({...f,couponServiceIds:[...new Set(next)]}));}}/>{service?.title}</label>)}
  </div></details></div>
  <label className="price-modal-field"><span>Search account</span><input value={query} placeholder="Search username, name or email" autoComplete="off" onChange={e=>{setQuery(e.target.value);setResults([]);setMessage(e.target.value.trim().length>=2?'Searching…':'');setForm(f=>({...f,recipientAccountId:'',recipientEmail:''}));}}/></label>
  {!form.recipientAccountId && results.length>0 && <ul className="personal-customer-results">{results.map(user=><li key={user.id}><button type="button" onClick={()=>{setForm(f=>({...f,recipientAccountId:user.id,recipientEmail:user.email,recipientUsername:user.profile?.displayName || user.username || user.email}));setResults([]);setQuery('');}}>{user.profile?.profileImageUrl?<img src={user.profile.profileImageUrl} alt=""/>:<span className="personal-avatar">{(user.profile?.displayName || user.username || user.email)?.[0]?.toUpperCase()}</span>}<span>{user.profile?.displayName || user.username || user.email}<small>{user.username ? "@" + user.username + " · " : ""}{user.email}</small></span></button></li>)}</ul>}
  {form.recipientAccountId?<p>Selected: <strong>{form.recipientUsername}</strong></p>:message && <p className="personal-search-status" role="status">{message}</p>}
 </div>;
}
