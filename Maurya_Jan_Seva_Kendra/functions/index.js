const {onRequest} = require("firebase-functions/v2/https");
const {setGlobalOptions} = require("firebase-functions/v2");
const admin = require("firebase-admin");
admin.initializeApp();
setGlobalOptions({region:"asia-south1",maxInstances:10});
const db=admin.firestore(),auth=admin.auth();
const corsOrigins=["https://anshmaurya5619.github.io"];
function clean(x,n=120){return String(x||"").trim().slice(0,n);}
async function verify(req,roles=["admin"]){
 if(req.method!=="POST")throw new Error("POST required");
 const h=req.headers.authorization||"",m=h.match(/^Bearer (.+)$/);if(!m)throw new Error("Login required");
 const token=await auth.verifyIdToken(m[1]),snap=await db.doc("users/"+token.uid).get();
 if(!snap.exists||snap.data().status!=="active"||!roles.includes(snap.data().role))throw new Error("Not authorized");
 return {uid:token.uid,email:token.email||"",profile:snap.data()};
}
async function log(actor,action,target,extra={}){await db.collection("auditLogs").add({actorUid:actor.uid,actorEmail:actor.email,action,targetUid:target,extra,createdAt:admin.firestore.FieldValue.serverTimestamp()});}
async function run(req,res,roles,fn){
 const origin=req.headers.origin||"";if(corsOrigins.includes(origin)){res.set("Access-Control-Allow-Origin",origin);res.set("Vary","Origin");}
 res.set("Access-Control-Allow-Headers","Authorization, Content-Type");res.set("Access-Control-Allow-Methods","POST, OPTIONS");
 if(req.method==="OPTIONS")return res.status(204).send("");
 try{const actor=await verify(req,roles);const data=req.body?.data||req.body||{};return res.json({result:await fn(actor,data)});}
 catch(e){const code=e.message==="Login required"?401:e.message==="Not authorized"?403:400;return res.status(code).json({error:{message:e.message||"Request failed"}});}
}
async function customerCreate(uid,details,status,creator=null){
 const ctr=db.doc("customerCounters/main");
 return db.runTransaction(async tx=>{const cs=await tx.get(ctr),n=cs.exists?Number(cs.data().next||1):1,id="MJK-"+String(n).padStart(6,"0");tx.set(ctr,{next:n+1},{merge:true});
 const d={uid,customerId:id,role:"customer",status,name:clean(details.name),phone:clean(details.phone,20),email:clean(details.email,200).toLowerCase(),address:clean(details.address,300),createdByUid:creator?.uid||null,createdByEmail:creator?.email||null,createdAt:admin.firestore.FieldValue.serverTimestamp(),updatedAt:admin.firestore.FieldValue.serverTimestamp(),archivedAt:null};
 tx.create(db.doc("users/"+uid),d);tx.create(db.doc("customers/"+uid),d);return id;});
}
// Customer Auth account must be created first; this callable HTTP endpoint requires a valid ID token.
exports.registerCustomerProfile=onRequest(async(req,res)=>run(req,res,["customer"],async(actor,d)=>{throw new Error("For safety, customer self-registration is not enabled in this starter. Add a separate rate-limited signup endpoint before allowing public account creation.");}));
exports.searchCustomers=onRequest(async(req,res)=>run(req,res,["admin","worker"],async(actor,d)=>{
 const field=clean(d.field,20),value=clean(d.value,120);if(!value||!["customerId","name","phone"].includes(field))throw new Error("Invalid search");
 let q;if(field==="customerId")q=db.collection("customers").where("customerId","==",value.toUpperCase()).limit(20);else q=db.collection("customers").orderBy(field).startAt(value).endAt(value+"\uf8ff").limit(20);
 const snap=await q.get();const customers=snap.docs.map(x=>x.data());await log(actor,"search_customers","",{field,value});return {customers};
}));
exports.listPendingCustomers=onRequest(async(req,res)=>run(req,res,["admin"],async()=>{const s=await db.collection("users").where("role","==","customer").where("status","==","pending").limit(100).get();return {customers:s.docs.map(d=>({uid:d.id,...d.data()}))};}));
exports.listArchivedCustomers=onRequest(async(req,res)=>run(req,res,["admin"],async()=>{const s=await db.collection("customers").where("status","==","archived").limit(100).get();return {customers:s.docs.map(d=>d.data())};}));
async function updateCustomer(actor,uid,status,extra={}){
 uid=clean(uid,128);if(!uid)throw new Error("Customer UID required");
 const u=db.doc("users/"+uid),c=db.doc("customers/"+uid),s=await u.get();if(!s.exists||s.data().role!=="customer")throw new Error("Customer not found");
 const patch={status,updatedAt:admin.firestore.FieldValue.serverTimestamp(),...extra};
 await u.set(patch,{merge:true});await c.set(patch,{merge:true});await log(actor,status+"_customer",uid);return {ok:true};
}
exports.approveCustomer=onRequest(async(req,res)=>run(req,res,["admin"],async(a,d)=>updateCustomer(a,d.uid,"active",{approvedByUid:a.uid,approvedAt:admin.firestore.FieldValue.serverTimestamp()})));
exports.archiveCustomer=onRequest(async(req,res)=>run(req,res,["admin"],async(a,d)=>updateCustomer(a,d.uid,"archived",{archivedByUid:a.uid,archivedAt:admin.firestore.FieldValue.serverTimestamp()})));
exports.restoreCustomer=onRequest(async(req,res)=>run(req,res,["admin"],async(a,d)=>{const u=await db.doc("users/"+clean(d.uid,128)).get();if(!u.exists||u.data().status!=="archived")throw new Error("Archived customer not found");return updateCustomer(a,d.uid,"active",{archivedAt:null,restoredByUid:a.uid,restoredAt:admin.firestore.FieldValue.serverTimestamp()});}));
