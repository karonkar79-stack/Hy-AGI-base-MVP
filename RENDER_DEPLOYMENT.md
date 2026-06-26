# 🚀 Render.com Deployment Guide

## Quick Deploy (5 minutes)

### Option 1: One-Click Deploy (Easiest)

1. **Visit Render Dashboard**: https://dashboard.render.com/
2. **Click "New +"** → **"Web Service"**
3. **Connect GitHub**: Authorize Render to access your repositories
4. **Select Repository**: `karonkar79-stack/Hy-AGI-base-MVP`
5. **Configure Service**:
   ```
   Name: hyagi-backend
   Region: Oregon (US West)
   Branch: master
   Root Directory: backend
   Build Command: npm install && npm run build
   Start Command: npm start
   Plan: Free
   ```

6. **Add Environment Variable**:
   - Click "Environment" tab
   - Add: `ANTHROPIC_API_KEY` = `<your_api_key_from_team_lead>`
   - (The actual API key is in backend/.env file)

7. **Deploy**: Click "Create Web Service"

### Option 2: Using render.yaml (Automated)

The repository includes `render.yaml` for automated deployment:

1. Go to: https://dashboard.render.com/select-repo?type=blueprint
2. Select: `karonkar79-stack/Hy-AGI-base-MVP`
3. The blueprint will auto-configure everything
4. Add the `ANTHROPIC_API_KEY` environment variable
5. Click "Apply"

## 📋 Deployment Checklist

- [x] Repository pushed to GitHub
- [x] render.yaml configured
- [x] Server code complete
- [x] Health check endpoint working
- [ ] Create Render account (if needed)
- [ ] Deploy service
- [ ] Add API key
- [ ] Verify deployment

## 🔗 Access Your Deployed API

Once deployed, your API will be available at:
```
https://hyagi-backend.onrender.com
```

Test it:
```bash
curl https://hyagi-backend.onrender.com/api/health
```

## 🎨 Frontend Deployment (Optional)

Deploy frontend separately to Vercel for better performance:

### Vercel Deployment

1. **Install Vercel CLI** (if not installed):
   ```bash
   npm install -g vercel
   ```

2. **Deploy Frontend**:
   ```bash
   cd frontend
   vercel --prod
   ```

3. **Update Backend CORS**:
   - Go to Render dashboard
   - Add environment variable:
     - `CORS_ORIGIN` = `https://your-frontend.vercel.app`

## 📊 Monitoring Your Deployment

### Health Check
```bash
curl https://hyagi-backend.onrender.com/api/health
```

Expected response:
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "agents": ["sr-pentester"],
  "timestamp": "2026-06-27T..."
}
```

### Get Available Agents
```bash
curl https://hyagi-backend.onrender.com/api/agents
```

### Run a Demo Task
```bash
curl -X POST https://hyagi-backend.onrender.com/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "sr-pentester",
    "target": "example.com",
    "skill": "sqli_detection"
  }'
```

### View Metrics
```bash
curl https://hyagi-backend.onrender.com/api/metrics
```

## ⚠️ Important Notes

### Free Tier Limitations
- **Spin down after 15 minutes of inactivity**
- Cold start: 30-60 seconds on first request
- 750 hours/month (enough for continuous uptime)
- Shared CPU/RAM

### Keeping Service Awake
Add this to your cron or use UptimeRobot:
```bash
# Ping every 10 minutes
*/10 * * * * curl https://hyagi-backend.onrender.com/api/health
```

### Environment Variables to Set

| Variable | Value | Required |
|----------|-------|----------|
| `ANTHROPIC_API_KEY` | Your Anthropic key | ✅ Yes |
| `NODE_ENV` | `production` | Auto-set |
| `PORT` | `10000` | Auto-set |
| `CORS_ORIGIN` | Frontend URL | Optional |
| `LOG_LEVEL` | `info` | Optional |

## 🐛 Troubleshooting

### "Build Failed"
Check build logs in Render dashboard. Common issues:
- Missing dependencies: Run `npm install` locally first
- TypeScript errors: Check `npm run build` locally
- Node version: Ensure Node 20+ in `package.json`

### "Service Unavailable"
- Check if service is spinning up (cold start)
- View logs in Render dashboard
- Verify health check endpoint responds

### "API Key Error"
- Verify `ANTHROPIC_API_KEY` is set correctly
- Check for extra spaces or quotes
- Ensure key is valid

## 📈 Scaling to Production

When ready to scale beyond free tier:

### Upgrade Plan
- **Starter**: $7/month (512MB RAM, always on)
- **Standard**: $25/month (2GB RAM, better performance)

### Add PostgreSQL
```bash
# In Render dashboard
New + → PostgreSQL
Connect to backend service
```

### Add Redis
```bash
# Use Upstash Redis (free tier)
https://upstash.com/
Add REDIS_URL to environment
```

## 🎉 Success!

Once deployed, you'll have:
- ✅ Public API at `https://hyagi-backend.onrender.com`
- ✅ Sr. Pentester agent live and working
- ✅ Demo endpoints for testing
- ✅ Auto-deployment from GitHub (push to master = auto-deploy)

Share this URL with your team to test the MVP!

---

**Deployment Time**: ~5 minutes
**Status**: Ready to deploy
**Repository**: https://github.com/karonkar79-stack/Hy-AGI-base-MVP
