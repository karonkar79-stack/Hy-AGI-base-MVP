# 🚀 Quick Start Guide

## For Team Members - Get Running in 5 Minutes

### Prerequisites Check
```bash
node --version  # Need v20+
docker --version  # Need for databases
git --version
```

### 1. Clone & Setup (2 minutes)
```bash
# Clone the repository
git clone https://github.com/karonkar79-stack/Hy-AGI-base-MVP.git
cd Hy-AGI-base-MVP

# Install dependencies
cd backend
npm install
```

### 2. Start Infrastructure (1 minute)
```bash
# Start PostgreSQL, Redis, Neo4j
docker-compose up -d

# Wait for services to be ready (check with the command below)
docker-compose ps
```

### 3. Configure API Key (30 seconds)
```bash
# Copy environment template
cp .env.example .env

# Edit .env and add the Anthropic API key
# The key is provided separately by team lead
# ANTHROPIC_API_KEY=your_key_here
```

**Get API key from team lead or**: The actual key is already in `backend/.env` in the repository!

### 4. Start Development Server (30 seconds)
```bash
npm run dev
```

You should see:
```
[INFO] Server started on port 3000
[INFO] Agent initialized: sr-pentester (Sr. Pentester)
```

### 5. Test the API (1 minute)
```bash
# In another terminal
curl http://localhost:3000/api/health

# Should return:
# {"status":"healthy","agents":["sr-pentester"]}
```

### 6. Open Frontend
```bash
# In another terminal
cd ../frontend
python -m http.server 8080

# Or simply open frontend/index.html in your browser
```

Visit: `http://localhost:8080`

## 🎯 Your First Task

### If you're implementing Jr. Pentester:
```bash
# Create your agent directory
cd backend/src/agents
mkdir jr-pentester
cd jr-pentester

# Create files
touch index.ts skills.ts prompts.ts tests.test.ts
```

Copy the structure from `sr-pentester/` and follow `docs/AGENT_GUIDE.md`

### Test Your Agent
```bash
npm test -- --grep "Jr.Pentester"
```

## 🐛 Troubleshooting

### "Cannot connect to database"
```bash
# Check if containers are running
docker-compose ps

# Restart them
docker-compose restart

# Check logs
docker-compose logs postgres
```

### "Module not found"
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### "API Key Invalid"
- Check the key in `.env` has no quotes
- Ensure no extra spaces
- Get latest key from team lead

## 📚 Next Steps

1. ✅ Read `docs/AGENT_GUIDE.md` - Your implementation guide
2. ✅ Study `src/agents/sr-pentester/` - Reference implementation
3. ✅ Review `docs/ARCHITECTURE.md` - Understand the system
4. ✅ Implement your assigned agent
5. ✅ Write tests (>80% coverage)
6. ✅ Submit PR

## 🎉 Ready to Code!

You're all set! Check your assignment:
- **Jr. Pentester** → Team Member #1
- **Web App Tester** → Team Member #2
- **Security Architect** → Team Member #3
- **Reviewer** → Team Member #4

Good luck! 🚀
