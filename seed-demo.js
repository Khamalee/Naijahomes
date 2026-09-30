require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const pool = new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL?.includes('localhost')?false:{rejectUnauthorized:false}});
(async()=>{
 const accounts=[
  ['NaijaHomes Admin','admin@naijahomes.local','08000000000','Admin123!','admin'],
  ['Demo Agent','agent@naijahomes.local','08000000001','Agent123!','agent'],
  ['Demo User','user@naijahomes.local','08000000002','User123!','user']
 ];
 for(const [name,email,phone,pw,role] of accounts){const hash=await bcrypt.hash(pw,12);await pool.query(`INSERT INTO users(full_name,email,phone,password_hash,role) VALUES($1,$2,$3,$4,$5) ON CONFLICT(email) DO UPDATE SET full_name=EXCLUDED.full_name,phone=EXCLUDED.phone,password_hash=EXCLUDED.password_hash,role=EXCLUDED.role`,[name,email,phone,hash,role]);}
 const agent=(await pool.query("SELECT id FROM users WHERE email='agent@naijahomes.local'")).rows[0].id;
 const count=(await pool.query("SELECT COUNT(*)::int n FROM properties WHERE owner_id=$1",[agent])).rows[0].n;
 if(!count){await pool.query(`INSERT INTO properties(owner_id,title,description,listing_type,property_type,price,bedrooms,bathrooms,area_sqm,city,neighborhood,address,latitude,longitude,amenities,images,verified,status) VALUES
 ($1,'Modern 4 Bedroom Duplex in Lekki','Demo listing for the NaijaHomes marketplace.','sale','duplex',185000000,4,5,320,'lagos','Lekki Phase 1','Lekki Phase 1, Lagos',6.4474,3.4713,'["Parking","Security","BQ","Fitted kitchen"]'::jsonb,'[]'::jsonb,true,'active'),
 ($1,'3 Bedroom Apartment in Akure','Demo listing awaiting admin review.','rent','apartment',2800000,3,3,180,'akure','Alagbaka','Alagbaka, Akure',7.2571,5.2058,'["Parking","Water","Security"]'::jsonb,'[]'::jsonb,false,'pending')`,[agent]);}
 console.log('Demo accounts ready:'); console.log('Admin: admin@naijahomes.local / Admin123!'); console.log('Agent: agent@naijahomes.local / Agent123!'); console.log('User: user@naijahomes.local / User123!'); await pool.end();
})().catch(e=>{console.error(e);process.exit(1)});
