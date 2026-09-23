const prisma = require('../prisma');
exports.searchCustomers = async (req,res) => {
 const q=typeof req.query.q==='string'?req.query.q.trim():'';
 if(q.length<2||q.length>80)return res.json({ok:true,customers:[]});
 try {
 const customers=await prisma.user.findMany({where:{OR:[{username:{contains:q,mode:'insensitive'}},{email:{contains:q,mode:'insensitive'}},{profile:{displayName:{contains:q,mode:'insensitive'}}}]},select:{id:true,username:true,email:true,profile:{select:{profileImageUrl:true,displayName:true}}},orderBy:{username:'asc'},take:8});
 res.set('Cache-Control','no-store');return res.json({ok:true,customers});
 }catch{return res.status(500).json({ok:false,message:'Unable to search accounts.'});}
};
exports.myCoupons = async(req,res)=>{
 try {
 const userId=req.user.id||req.user.userId;
 const now=new Date();
 const coupons=await prisma.serviceSale.findMany({where:{active:true,couponCode:{not:null},AND:[{OR:[{recipientAccountId:null},{recipientAccountId:userId}]},{OR:[{endsAt:null},{endsAt:{gt:now}}]}]},select:{id:true,title:true,couponCode:true,discountPercent:true,scope:true,serviceId:true,couponServiceIds:true,startsAt:true,endsAt:true,couponUses:{where:{accountId:userId,usedAt:{not:null}},select:{id:true}}},orderBy:{createdAt:'desc'},take:100});
 const ids=[...new Set(coupons.flatMap(c=>c.couponServiceIds.length?c.couponServiceIds:c.serviceId?[c.serviceId]:[]))];
 const services=ids.length?await prisma.service.findMany({where:{id:{in:ids}},select:{id:true,title:true}}):[];
 res.set('Cache-Control','no-store');return res.json({ok:true,coupons:coupons.map(({couponUses,...c})=>({...c,used:couponUses.length>0,serviceTitles:(c.couponServiceIds.length?c.couponServiceIds:c.serviceId?[c.serviceId]:[]).map(id=>services.find(s=>s.id===id)?.title||'Service')}))});
 }catch{return res.status(500).json({ok:false,message:'Unable to load coupons.'});}
};
