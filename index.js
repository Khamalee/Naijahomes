require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { v2: cloudinary } = require("cloudinary");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 12, fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype))
});
function uploadToCloudinary(file) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: "naijahomes/properties", resource_type: "image" },
      (err, result) => err ? reject(err) : resolve(result.secure_url)
    );
    stream.end(file.buffer);
  });
}

const app = express();
const PORT = process.env.PORT || 4000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false } });

app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json({ limit: "2mb" }));

function sign(user){ return jwt.sign({id:user.id,role:user.role,email:user.email}, process.env.JWT_SECRET, {expiresIn:"7d"}); }
function auth(req,res,next){
  const h=req.headers.authorization||"";
  if(!h.startsWith("Bearer ")) return res.status(401).json({error:"Authentication required"});
  try { req.user=jwt.verify(h.slice(7),process.env.JWT_SECRET); next(); }
  catch { return res.status(401).json({error:"Invalid or expired token"}); }
}
function agentOrAdmin(req,res,next){ if(!["agent","admin"].includes(req.user.role)) return res.status(403).json({error:"Agent account required"}); next(); }
function adminOnly(req,res,next){ if(req.user.role!=="admin") return res.status(403).json({error:"Admin access required"}); next(); }

app.get("/api/health", (_,res)=>res.json({ok:true,service:"NaijaHomes API"}));

app.post("/api/auth/register", async (req,res)=>{
  try{
    const {fullName,email,phone,password,role="user"}=req.body;
    if(!fullName||!email||!password) return res.status(400).json({error:"Name, email and password are required"});
    if(!["user","agent"].includes(role)) return res.status(400).json({error:"Invalid role"});
    const hash=await bcrypt.hash(password,12);
    const r=await pool.query("INSERT INTO users(full_name,email,phone,password_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING id,full_name,email,phone,role",[fullName,email.toLowerCase(),phone||null,hash,role]);
    res.status(201).json({user:r.rows[0],token:sign(r.rows[0])});
  }catch(e){ res.status(e.code==="23505"?409:500).json({error:e.code==="23505"?"Email already registered":"Registration failed"}); }
});

app.post("/api/auth/login", async (req,res)=>{
  const {email,password}=req.body;
  const r=await pool.query("SELECT * FROM users WHERE email=$1",[String(email||"").toLowerCase()]);
  const u=r.rows[0];
  if(!u || !(await bcrypt.compare(password||"",u.password_hash))) return res.status(401).json({error:"Invalid email or password"});
  const safe={id:u.id,full_name:u.full_name,email:u.email,phone:u.phone,role:u.role};
  res.json({user:safe,token:sign(safe)});
});

app.get("/api/me",auth,async(req,res)=>{
  const r=await pool.query("SELECT id,full_name,email,phone,role,created_at FROM users WHERE id=$1",[req.user.id]);
  res.json(r.rows[0]);
});

app.get("/api/admin/stats",auth,adminOnly,async(req,res)=>{
  try {
    const r=await pool.query(`SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM users WHERE role='agent') AS agents,
      (SELECT COUNT(*) FROM properties) AS properties,
      (SELECT COUNT(*) FROM properties WHERE status='pending') AS pending,
      (SELECT COUNT(*) FROM properties WHERE status='active') AS active,
      (SELECT COUNT(*) FROM properties WHERE status='hidden') AS hidden,
      (SELECT COUNT(*) FROM inquiries) AS inquiries`);
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:"Could not load admin stats"}); }
});

app.get("/api/admin/properties",auth,adminOnly,async(req,res)=>{
  try {
    const status=req.query.status && req.query.status!=="all" ? req.query.status : null;
    const q=req.query.q ? `%${req.query.q}%` : null;
    const args=[]; const where=[];
    if(status){args.push(status);where.push(`p.status=$${args.length}`)}
    if(q){args.push(q);where.push(`(p.title ILIKE $${args.length} OR p.neighborhood ILIKE $${args.length} OR p.city ILIKE $${args.length} OR u.full_name ILIKE $${args.length})`)}
    const sql=`SELECT p.*,u.full_name AS agent_name,u.email AS agent_email,u.phone AS agent_phone
      FROM properties p LEFT JOIN users u ON u.id=p.owner_id
      ${where.length?"WHERE "+where.join(" AND "):""}
      ORDER BY CASE WHEN p.status='pending' THEN 0 ELSE 1 END,p.created_at DESC LIMIT 200`;
    const r=await pool.query(sql,args);
    res.json({properties:r.rows});
  } catch(e) { console.error(e); res.status(500).json({error:"Could not load admin listings"}); }
});

app.get("/api/admin/users",auth,adminOnly,async(req,res)=>{
  try {
    const r=await pool.query(`SELECT u.id,u.full_name,u.email,u.phone,u.role,u.created_at,COUNT(p.id)::int AS property_count
      FROM users u LEFT JOIN properties p ON p.owner_id=u.id GROUP BY u.id ORDER BY u.created_at DESC LIMIT 200`);
    res.json({users:r.rows});
  } catch(e) { res.status(500).json({error:"Could not load users"}); }
});

app.patch("/api/admin/properties/:id/review",auth,adminOnly,async(req,res)=>{
  const {status,verified}=req.body;
  const allowed=["active","pending","hidden","sold","rented"];
  if(status && !allowed.includes(status)) return res.status(400).json({error:"Invalid listing status"});
  if(status===undefined && verified===undefined) return res.status(400).json({error:"Status or verification is required"});
  try {
    const fields=[],args=[];
    if(status!==undefined){args.push(status);fields.push(`status=$${args.length}`)}
    if(verified!==undefined){args.push(Boolean(verified));fields.push(`verified=$${args.length}`)}
    args.push(req.params.id);
    const r=await pool.query(`UPDATE properties SET ${fields.join(",")} WHERE id=$${args.length} RETURNING *`,args);
    if(!r.rows[0]) return res.status(404).json({error:"Property not found"});
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({error:"Could not update listing"}); }
});

app.get("/api/properties",async(req,res)=>{
  const {city,type,minPrice,maxPrice,bedrooms,q,limit=30,offset=0}=req.query;
  const where=["p.status='active'"], args=[];
  const add=(sql,val)=>{args.push(val);where.push(sql.replace("?",`$${args.length}`));};
  if(city && city!=="all") add("LOWER(p.city)=LOWER(?)",city);
  if(type && type!=="all") add("p.listing_type=?",type);
  if(minPrice) add("p.price>=?",Number(minPrice));
  if(maxPrice) add("p.price<=?",Number(maxPrice));
  if(bedrooms) add("p.bedrooms>=?",Number(bedrooms));
  if(q){args.push(`%${q}%`);where.push(`(p.title ILIKE $${args.length} OR p.neighborhood ILIKE $${args.length} OR p.city ILIKE $${args.length})`);}
  const lim=Math.min(Number(limit)||30,100); const off=Math.max(Number(offset)||0,0);
  const sql=`SELECT p.*, u.full_name AS agent_name, u.phone AS agent_phone
             FROM properties p LEFT JOIN users u ON u.id=p.owner_id
             WHERE ${where.join(" AND ")} ORDER BY p.created_at DESC LIMIT $${args.length+1} OFFSET $${args.length+2}`;
  args.push(lim,off);
  const r=await pool.query(sql,args);
  res.json({properties:r.rows,count:r.rowCount});
});

app.get("/api/properties/:id",async(req,res)=>{
  const r=await pool.query(`SELECT p.*,u.full_name AS agent_name,u.phone AS agent_phone,u.email AS agent_email
    FROM properties p LEFT JOIN users u ON u.id=p.owner_id WHERE p.id=$1`,[req.params.id]);
  if(!r.rows[0]) return res.status(404).json({error:"Property not found"});
  res.json(r.rows[0]);
});

app.post("/api/uploads/property-images", auth, agentOrAdmin, upload.array("images", 12), async (req,res)=>{
  try {
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET)
      return res.status(500).json({error:"Cloud image storage is not configured"});
    if (!req.files?.length) return res.status(400).json({error:"No images uploaded"});
    const urls = await Promise.all(req.files.map(uploadToCloudinary));
    res.status(201).json({images: urls});
  } catch(e) {
    console.error(e);
    res.status(500).json({error:"Image upload failed"});
  }
});

app.post("/api/properties",auth,agentOrAdmin,async(req,res)=>{
  const x=req.body;
  if(!x.title||!x.listingType||x.price===undefined||!x.city||!x.neighborhood) return res.status(400).json({error:"Title, listing type, price, city and neighborhood are required"});
  const r=await pool.query(`INSERT INTO properties
    (owner_id,title,description,listing_type,property_type,price,bedrooms,bathrooms,area_sqm,city,neighborhood,address,latitude,longitude,amenities,images,status)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'pending') RETURNING *`,
    [req.user.id,x.title,x.description||null,x.listingType,x.propertyType||"house",x.price,x.bedrooms||0,x.bathrooms||0,x.areaSqm||null,x.city,x.neighborhood,x.address||null,x.latitude||null,x.longitude||null,JSON.stringify(x.amenities||[]),JSON.stringify(x.images||[])]);
  res.status(201).json(r.rows[0]);
});

app.patch("/api/properties/:id",auth,async(req,res)=>{
  const own=await pool.query("SELECT owner_id FROM properties WHERE id=$1",[req.params.id]);
  if(!own.rows[0]) return res.status(404).json({error:"Property not found"});
  if(own.rows[0].owner_id!==req.user.id && req.user.role!=="admin") return res.status(403).json({error:"Not allowed"});
  const x=req.body;
  const fields=[],args=[];
  const allowed={title:"title",description:"description",price:"price",bedrooms:"bedrooms",bathrooms:"bathrooms",neighborhood:"neighborhood",address:"address",status:"status",images:"images",amenities:"amenities"};
  for(const [k,col] of Object.entries(allowed)) if(x[k]!==undefined){args.push((k==="images"||k==="amenities")?JSON.stringify(x[k]):x[k]);fields.push(`${col}=$${args.length}`)}
  if(!fields.length) return res.status(400).json({error:"No changes supplied"});
  args.push(req.params.id);
  const r=await pool.query(`UPDATE properties SET ${fields.join(",")} WHERE id=$${args.length} RETURNING *`,args);
  res.json(r.rows[0]);
});

app.get("/api/me/saved",auth,async(req,res)=>{
  try {
    const r=await pool.query(`SELECT p.*,u.full_name AS agent_name,u.phone AS agent_phone
      FROM saved_properties s JOIN properties p ON p.id=s.property_id LEFT JOIN users u ON u.id=p.owner_id
      WHERE s.user_id=$1 ORDER BY s.created_at DESC`,[req.user.id]);
    res.json({properties:r.rows});
  } catch(e){ res.status(500).json({error:"Could not load saved properties"}); }
});

app.get("/api/agent/properties",auth,async(req,res)=>{
  if(!["agent","admin"].includes(req.user.role)) return res.status(403).json({error:"Agent access required"});
  const owner=req.user.role==="admin" && req.query.ownerId ? req.query.ownerId : req.user.id;
  try {
    const r=await pool.query(`SELECT p.*,u.full_name AS agent_name FROM properties p LEFT JOIN users u ON u.id=p.owner_id WHERE p.owner_id=$1 ORDER BY p.created_at DESC`,[owner]);
    res.json({properties:r.rows});
  } catch(e){ res.status(500).json({error:"Could not load agent listings"}); }
});

app.get("/api/properties/:id/saved",auth,async(req,res)=>{
  const r=await pool.query("SELECT 1 FROM saved_properties WHERE user_id=$1 AND property_id=$2",[req.user.id,req.params.id]);
  res.json({saved:!!r.rows[0]});
});

app.post("/api/properties/:id/saved",auth,async(req,res)=>{
  try {
    await pool.query("INSERT INTO saved_properties(user_id,property_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[req.user.id,req.params.id]);
    res.status(201).json({saved:true});
  } catch(e) {
    if(e.code==="23503") return res.status(404).json({error:"Property not found"});
    res.status(500).json({error:"Could not save property"});
  }
});

app.delete("/api/properties/:id/saved",auth,async(req,res)=>{
  await pool.query("DELETE FROM saved_properties WHERE user_id=$1 AND property_id=$2",[req.user.id,req.params.id]);
  res.json({saved:false});
});

app.post("/api/properties/:id/inquiries",async(req,res)=>{
  const {name,phone,email,message}=req.body;
  if(!name||!message) return res.status(400).json({error:"Name and message are required"});
  const r=await pool.query(`INSERT INTO inquiries(property_id,user_id,name,phone,email,message) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,created_at`,
    [req.params.id,req.user?.id||null,name,phone||null,email||null,message]);
  res.status(201).json(r.rows[0]);
});

app.use(express.static(__dirname));
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"index.html")));

app.listen(PORT,()=>console.log(`NaijaHomes running on http://localhost:${PORT}`));
