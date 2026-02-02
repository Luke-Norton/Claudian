# Google Drive API Quick Reference

## Setup (One-time only)
```powershell
.\SetupGoogleDrive.ps1
```

## Load API Functions (each session)
```powershell
Import-Module "./GoogleDriveAPI.ps1"
Load-GoogleTokens  # Load saved authentication
```

## Available Functions

### 📁 File Management
```powershell
# List all files
Get-GoogleDriveFiles

# Search files by name
Get-GoogleDriveFiles -Query "name contains 'report'"

# Search by file type
Get-GoogleDriveFiles -Query "mimeType='application/vnd.google-apps.document'"  # Google Docs
Get-GoogleDriveFiles -Query "mimeType='application/vnd.google-apps.spreadsheet'"  # Google Sheets

# Get file content (for downloadable files)
Get-GoogleDriveFileContent -FileId "your-file-id"
```

### 📝 Google Docs
```powershell
# Create new document
New-GoogleDoc -Title "My New Document" -Content "Hello World!"

# Update document content (requires additional API calls)
$UpdateUri = "https://docs.googleapis.com/v1/documents/DOCUMENT_ID:batchUpdate"
$Body = @{
    requests = @(
        @{
            insertText = @{
                location = @{ index = 1 }
                text = "New content to insert"
            }
        }
    )
}
Invoke-GoogleAPI -Uri $UpdateUri -Method "POST" -Body $Body
```

### 📊 Google Sheets
```powershell
# Create new spreadsheet
$Uri = "https://sheets.googleapis.com/v4/spreadsheets"
$Body = @{
    properties = @{
        title = "My New Spreadsheet"
    }
}
Invoke-GoogleAPI -Uri $Uri -Method "POST" -Body $Body

# Read sheet data
$SpreadsheetId = "your-spreadsheet-id"
$Range = "Sheet1!A1:Z100"
$Uri = "https://sheets.googleapis.com/v4/spreadsheets/$SpreadsheetId/values/$Range"
Invoke-GoogleAPI -Uri $Uri

# Write to sheet
$Uri = "https://sheets.googleapis.com/v4/spreadsheets/$SpreadsheetId/values/$Range"
$Body = @{
    values = @(
        @("Name", "Age", "City"),
        @("John", "30", "New York"),
        @("Jane", "25", "Los Angeles")
    )
}
Invoke-GoogleAPI -Uri $Uri -Method "PUT" -Body $Body
```

### 🔧 General API Access
```powershell
# Make any Google API call
Invoke-GoogleAPI -Uri "https://www.googleapis.com/drive/v3/about" -Method "GET"

# POST request with data
Invoke-GoogleAPI -Uri $ApiUrl -Method "POST" -Body $DataHashtable
```

## Common MIME Types
- Google Docs: `application/vnd.google-apps.document`
- Google Sheets: `application/vnd.google-apps.spreadsheet`
- Google Slides: `application/vnd.google-apps.presentation`
- PDF: `application/pdf`
- Word Doc: `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- Excel: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

## Query Examples
```powershell
# Find documents modified in last 7 days
Get-GoogleDriveFiles -Query "modifiedTime > '$(((Get-Date).AddDays(-7)).ToString("yyyy-MM-ddTHH:mm:ss"))'"

# Find files in specific folder
Get-GoogleDriveFiles -Query "'FOLDER_ID' in parents"

# Find files by owner
Get-GoogleDriveFiles -Query "owners:'user@example.com'"

# Combine conditions
Get-GoogleDriveFiles -Query "name contains 'report' and mimeType='application/vnd.google-apps.document'"
```

## Troubleshooting
- If tokens expire, run `Load-GoogleTokens` to refresh
- Check `google_tokens.json` exists in current directory
- For detailed errors, check PowerShell error messages
- Re-run setup if authentication fails completely