# Google Drive API PowerShell Wrapper
# Requires OAuth 2.0 credentials from Google Cloud Console

param(
    [string]$ClientId,
    [string]$ClientSecret,
    [string]$RedirectUri = "http://localhost:8080"
)

# Global variables for API access
$script:AccessToken = $null
$script:RefreshToken = $null
$script:TokenExpiry = $null

# Function to get OAuth authorization URL
function Get-GoogleAuthUrl {
    param(
        [string]$ClientId,
        [string]$RedirectUri = "http://localhost:8080",
        [string[]]$Scopes = @(
            "https://www.googleapis.com/auth/drive",
            "https://www.googleapis.com/auth/documents", 
            "https://www.googleapis.com/auth/spreadsheets"
        )
    )
    
    $ScopeString = [System.Web.HttpUtility]::UrlEncode($Scopes -join " ")
    $AuthUrl = "https://accounts.google.com/o/oauth2/v2/auth?" +
               "client_id=$ClientId&" +
               "redirect_uri=$([System.Web.HttpUtility]::UrlEncode($RedirectUri))&" +
               "scope=$ScopeString&" +
               "response_type=code&" +
               "access_type=offline&" +
               "prompt=consent"
    
    return $AuthUrl
}

# Function to exchange authorization code for tokens
function Get-GoogleTokens {
    param(
        [string]$AuthCode,
        [string]$ClientId,
        [string]$ClientSecret,
        [string]$RedirectUri = "http://localhost:8080"
    )
    
    $TokenUrl = "https://oauth2.googleapis.com/token"
    $Body = @{
        code = $AuthCode
        client_id = $ClientId
        client_secret = $ClientSecret
        redirect_uri = $RedirectUri
        grant_type = "authorization_code"
    }
    
    try {
        $Response = Invoke-RestMethod -Uri $TokenUrl -Method Post -Body $Body -ContentType "application/x-www-form-urlencoded"
        
        $script:AccessToken = $Response.access_token
        $script:RefreshToken = $Response.refresh_token
        $script:TokenExpiry = (Get-Date).AddSeconds($Response.expires_in)
        
        # Save tokens to file for persistence
        $TokenData = @{
            AccessToken = $script:AccessToken
            RefreshToken = $script:RefreshToken
            TokenExpiry = $script:TokenExpiry
            ClientId = $ClientId
            ClientSecret = $ClientSecret
        }
        $TokenData | ConvertTo-Json | Out-File -FilePath "google_tokens.json" -Encoding UTF8
        
        Write-Host "✅ Authentication successful! Tokens saved to google_tokens.json"
        return $Response
    }
    catch {
        Write-Error "Failed to get tokens: $($_.Exception.Message)"
        return $null
    }
}

# Function to refresh access token
function Refresh-GoogleToken {
    if (-not $script:RefreshToken) {
        Write-Error "No refresh token available. Re-authentication required."
        return $false
    }

    # Load client credentials from saved token file
    if (-not (Test-Path "google_tokens.json")) {
        Write-Error "Token file not found. Re-authentication required."
        return $false
    }

    $TokenData = Get-Content "google_tokens.json" | ConvertFrom-Json

    $TokenUrl = "https://oauth2.googleapis.com/token"
    $Body = @{
        refresh_token = $script:RefreshToken
        client_id = $TokenData.ClientId
        client_secret = $TokenData.ClientSecret
        grant_type = "refresh_token"
    }

    try {
        $Response = Invoke-RestMethod -Uri $TokenUrl -Method Post -Body $Body -ContentType "application/x-www-form-urlencoded"

        $script:AccessToken = $Response.access_token
        $script:TokenExpiry = (Get-Date).AddSeconds($Response.expires_in)

        # Update saved token file with new access token
        $TokenData.AccessToken = $script:AccessToken
        $TokenData.TokenExpiry = $script:TokenExpiry
        $TokenData | ConvertTo-Json | Out-File -FilePath "google_tokens.json" -Encoding UTF8

        Write-Host "✅ Token refreshed successfully"
        return $true
    }
    catch {
        Write-Error "Failed to refresh token: $($_.Exception.Message)"
        return $false
    }
}

# Function to load saved tokens
function Load-GoogleTokens {
    if (Test-Path "google_tokens.json") {
        try {
            $TokenData = Get-Content "google_tokens.json" | ConvertFrom-Json
            $script:AccessToken = $TokenData.AccessToken
            $script:RefreshToken = $TokenData.RefreshToken
            $script:TokenExpiry = [DateTime]$TokenData.TokenExpiry
            
            # Check if token needs refresh
            if ((Get-Date) -gt $script:TokenExpiry.AddMinutes(-5)) {
                Write-Host "Token expired, refreshing..."
                if (-not (Refresh-GoogleToken)) {
                    return $false
                }
            }
            
            Write-Host "✅ Tokens loaded successfully"
            return $true
        }
        catch {
            Write-Error "Failed to load tokens: $($_.Exception.Message)"
            return $false
        }
    }
    return $false
}

# Function to make authenticated API requests
function Invoke-GoogleAPI {
    param(
        [string]$Uri,
        [string]$Method = "GET",
        [hashtable]$Body = @{},
        [string]$ContentType = "application/json"
    )
    
    if (-not $script:AccessToken) {
        Write-Error "No access token available. Authentication required."
        return $null
    }
    
    # Check if token needs refresh
    if ((Get-Date) -gt $script:TokenExpiry.AddMinutes(-5)) {
        if (-not (Refresh-GoogleToken)) {
            Write-Error "Failed to refresh token. Re-authentication required."
            return $null
        }
    }
    
    $Headers = @{
        "Authorization" = "Bearer $script:AccessToken"
        "Accept" = "application/json"
    }
    
    try {
        if ($Method -eq "GET" -or $Body.Count -eq 0) {
            $Response = Invoke-RestMethod -Uri $Uri -Method $Method -Headers $Headers
        } else {
            $JsonBody = $Body | ConvertTo-Json -Depth 10
            $Response = Invoke-RestMethod -Uri $Uri -Method $Method -Headers $Headers -Body $JsonBody -ContentType $ContentType
        }
        return $Response
    }
    catch {
        Write-Error "API request failed: $($_.Exception.Message)"
        return $null
    }
}

# Function to list Google Drive files
function Get-GoogleDriveFiles {
    param(
        [string]$Query = "",
        [int]$PageSize = 100
    )
    
    $Uri = "https://www.googleapis.com/drive/v3/files?pageSize=$PageSize"
    if ($Query) {
        $Uri += "&q=$([System.Web.HttpUtility]::UrlEncode($Query))"
    }
    
    $Response = Invoke-GoogleAPI -Uri $Uri
    return $Response.files
}

# Function to get file content
function Get-GoogleDriveFileContent {
    param(
        [string]$FileId
    )
    
    $Uri = "https://www.googleapis.com/drive/v3/files/$FileId?alt=media"
    return Invoke-GoogleAPI -Uri $Uri
}

# Function to create a new Google Doc
function New-GoogleDoc {
    param(
        [string]$Title,
        [string]$Content = ""
    )
    
    $Uri = "https://docs.googleapis.com/v1/documents"
    $Body = @{
        title = $Title
    }
    
    $Doc = Invoke-GoogleAPI -Uri $Uri -Method "POST" -Body $Body
    
    if ($Content -and $Doc) {
        # Add content to the document
        $UpdateUri = "https://docs.googleapis.com/v1/documents/$($Doc.documentId):batchUpdate"
        $UpdateBody = @{
            requests = @(
                @{
                    insertText = @{
                        location = @{ index = 1 }
                        text = $Content
                    }
                }
            )
        }
        Invoke-GoogleAPI -Uri $UpdateUri -Method "POST" -Body $UpdateBody
    }
    
    return $Doc
}

# Export functions for use
Export-ModuleMember -Function Get-GoogleAuthUrl, Get-GoogleTokens, Load-GoogleTokens, 
                              Get-GoogleDriveFiles, Get-GoogleDriveFileContent, New-GoogleDoc, 
                              Invoke-GoogleAPI

Write-Host "Google Drive API PowerShell wrapper loaded!"
Write-Host "Next steps:"
Write-Host "1. Set up OAuth credentials in Google Cloud Console"
Write-Host "2. Use Get-GoogleAuthUrl to get authorization URL"
Write-Host "3. Use Get-GoogleTokens to exchange auth code for tokens"
Write-Host "4. Start using API functions!"