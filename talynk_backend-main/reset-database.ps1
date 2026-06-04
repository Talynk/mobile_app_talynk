# Database Reset Script for Talynk Backend (PowerShell)
# This script resets the database, applies migrations, and seeds initial data

Write-Host "🔄 Starting database reset process..." -ForegroundColor Cyan

# Check if DATABASE_LOCAL is set
if (-not $env:DATABASE_LOCAL) {
    Write-Host "❌ Error: DATABASE_LOCAL environment variable is not set" -ForegroundColor Red
    Write-Host "Please set it in your .env file or export it:"
    Write-Host '$env:DATABASE_LOCAL = "postgresql://user:password@localhost:5432/talynk"'
    exit 1
}

Write-Host "📋 Step 1: Resetting Prisma migrations..." -ForegroundColor Yellow
# Reset all migrations (this will drop the database)
npx prisma migrate reset --force --skip-seed

Write-Host "📋 Step 2: Generating Prisma Client..." -ForegroundColor Yellow
npx prisma generate

Write-Host "📋 Step 3: Applying database schema..." -ForegroundColor Yellow
# Option 1: Use migrations (if you have migration files)
# npx prisma migrate deploy

# Option 2: Push schema directly (faster, for development)
npx prisma db push --accept-data-loss

Write-Host "📋 Step 4: Seeding initial data..." -ForegroundColor Yellow
Write-Host "Note: You can seed data via API endpoints or run seed scripts manually"
Write-Host "API Endpoints:"
Write-Host "  - POST /api/admin/seed/all (requires admin auth)"
Write-Host "  - POST /api/admin/seed/categories"
Write-Host "  - POST /api/admin/seed/countries"

Write-Host "✅ Database reset completed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "1. Start your server: npm start"
Write-Host "2. Seed data via API or use: npm run seed (if available)"
