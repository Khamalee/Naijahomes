# NaijaHomes — Final MVP

A Nigeria-focused property marketplace for Lagos and Akure with customer, agent and admin experiences.

## Included
- Public property search for Lagos and Akure
- Property detail pages with gallery, map, agent contact, WhatsApp and inquiry form
- Customer accounts and saved-property dashboard
- Agent registration/login and full listing submission workflow
- Map pinning with latitude/longitude
- Cloudinary property photo uploads (up to 12 images, 10 MB each)
- Admin dashboard for review, approval, rejection/hiding and verification
- Admin user/listing statistics
- PostgreSQL database + JWT authentication
- Responsive mobile-friendly UI
- Demo seed script with ready-to-use accounts

## Run locally
1. Install Node.js 18+ and PostgreSQL.
2. Create a PostgreSQL database named `naijahomes`.
3. Run `schema.sql` against that database.
4. Copy `.env.example` to `.env` and set `DATABASE_URL` and a strong `JWT_SECRET`.
5. Add Cloudinary credentials if you want agent photo uploads.
6. Run `npm install`.
7. Run `npm run seed-demo` to create demo accounts and sample listings.
8. Run `npm start`.
9. Open `http://localhost:4000`.

## Demo logins
- Admin: `admin@naijahomes.local` / `Admin123!`
- Agent: `agent@naijahomes.local` / `Agent123!`
- User: `user@naijahomes.local` / `User123!`

Change these credentials before any public deployment.

## Production note
This is a complete runnable MVP, not a hosted production service. You still need to provide your PostgreSQL and Cloudinary credentials and deploy the Node server to a host such as Render, Railway, Fly.io or another Node-compatible service. Before public launch, add rate limiting, email/phone verification, password reset, stronger validation, audit logging, backups and production security headers.
