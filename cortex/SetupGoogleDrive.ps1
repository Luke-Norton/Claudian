# Google Drive Setup Script
# This script will guide you through setting up Google Drive API access

Write-Host "🚀 Google Drive API Setup" -ForegroundColor Green
Write-Host "=========================" -ForegroundColor Green

# Step 1: Google Cloud Console Setup Instructions
Write-Host "`n📋 STEP 1: Google Cloud Console Setup" -ForegroundColor Yellow
Write-Host "Follow these steps to create your OAuth credentials:`n"

Write-Host "1. Go to: https://console.cloud.google.com/" -ForegroundColor Cyan
Write-Host "2. Create a new project or select existing one" -ForegroundColor Cyan
Write-Host "3. Enable the following APIs:" -ForegroundColor Cyan
Write-Host "   - Google Drive API" -ForegroundColor White
Write-Host "   - Google Docs API" -ForegroundColor White
Write-Host "   - Google Sheets API" -ForegroundColor White
Write-Host "4. Go to 'Credentials' in the left sidebar" -ForegroundColor Cyan
Write-Host "5. Click 'Create Credentials' → 'OAuth 2.0 Client ID'" -ForegroundColor Cyan
Write-Host "6. Choose 'Desktop application' as application type" -ForegroundColor Cyan
Write-Host "7. Name it something like 'PowerShell Google Drive Access'" -ForegroundColor Cyan
Write-Host "8. Download the credentials JSON file" -ForegroundColor Cyan

Write-Host "`n⏳ Complete the above steps, then press any key to continue..." -ForegroundColor Magenta
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

# Step 2: Get credentials from user
Write-Host "`n📝 STEP 2: Enter Your Credentials" -ForegroundColor Yellow

$ClientId = Read-Host "Enter your Client ID (from the credentials file)"
$ClientSecret = Read-Host "Enter your Client Secret (from the credentials file)"

# Step 3: Load our API wrapper
Write-Host "`n🔧 STEP 3: Loading Google Drive API Wrapper" -ForegroundColor Yellow
Import-Module "./GoogleDriveAPI.ps1" -Force

# Step 4: Generate authorization URL
Write-Host "`n🔐 STEP 4: Authorization" -ForegroundColor Yellow
$AuthUrl = Get-GoogleAuthUrl -ClientId $ClientId

Write-Host "`nPlease visit this URL in your browser:" -ForegroundColor Green
Write-Host $AuthUrl -ForegroundColor Cyan
Write-Host "`nThis will redirect you to a localhost URL with an authorization code." -ForegroundColor Green
Write-Host "Copy the 'code' parameter from that URL.`n" -ForegroundColor Green

# Try to open the URL automatically
try {
    Start-Process $AuthUrl
    Write-Host "✅ Browser should open automatically" -ForegroundColor Green
} catch {
    Write-Host "⚠️  Please manually copy and paste the URL above" -ForegroundColor Yellow
}

$AuthCode = Read-Host "Enter the authorization code from the redirect URL"

# Step 5: Exchange code for tokens
Write-Host "`n🎫 STEP 5: Getting Access Tokens" -ForegroundColor Yellow
$TokenResult = Get-GoogleTokens -AuthCode $AuthCode -ClientId $ClientId -ClientSecret $ClientSecret

if ($TokenResult) {
    Write-Host "`n✅ SUCCESS! Google Drive API is now set up." -ForegroundColor Green
    Write-Host "Testing API access..." -ForegroundColor Yellow
    
    # Test API access
    try {
        $Files = Get-GoogleDriveFiles | Select-Object -First 5
        Write-Host "`n📁 Your recent Google Drive files:" -ForegroundColor Green
        $Files | ForEach-Object {
            Write-Host "  - $($_.name) (ID: $($_.id))" -ForegroundColor White
        }
        
        Write-Host "`n🎉 Everything is working! You can now use Google Drive API functions." -ForegroundColor Green
        Write-Host "`nExample commands you can now use:" -ForegroundColor Yellow
        Write-Host "  Get-GoogleDriveFiles" -ForegroundColor Cyan
        Write-Host "  New-GoogleDoc -Title MyNewDoc -Content HelloWorld" -ForegroundColor Cyan
        
    } catch {
        Write-Host "⚠️  Setup completed but API test failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }
} else {
    Write-Host "❌ Failed to get tokens. Please try again." -ForegroundColor Red
}

Write-Host "`n📄 Credentials saved to google_tokens.json" -ForegroundColor Green
Write-Host "Use Import-Module ./GoogleDriveAPI.ps1 to load API functions in future sessions." -ForegroundColor Green