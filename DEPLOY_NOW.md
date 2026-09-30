# Deploy NaijaHomes

## Render
1. Put this project in a GitHub repository.
2. In Render, choose **New > Blueprint** and select the repository.
3. Render will read `render.yaml` and create the web service and PostgreSQL database.
4. Add the three Cloudinary secrets when prompted:
   - CLOUDINARY_CLOUD_NAME
   - CLOUDINARY_API_KEY
   - CLOUDINARY_API_SECRET
5. Deploy. The web service will be available at the Render URL.
6. After deployment, create an account and promote it to admin with:
   `UPDATE users SET role='admin' WHERE email='YOUR_EMAIL';`

The application serves the frontend and API from the same web service.
