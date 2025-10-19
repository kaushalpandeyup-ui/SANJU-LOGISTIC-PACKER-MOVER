# Download common static wixstatic images used by sanjulogisticspacker.com
# Saves files under vendor/static.wixstatic.com/media/...

$baseUrls = @(
    "https://static.wixstatic.com/media/11062b_6d470278d3c54005b49b96147fb2be4c~mv2.jpg",
    "https://static.wixstatic.com/media/11062b_dd78a6c415fe4777af42cbb6e3e1c49c~mv2.jpg",
    "https://static.wixstatic.com/media/11062b_b58444d0dad140688dc506c9f8e23f91~mv2.jpg",
    "https://static.wixstatic.com/media/df10e4_1979a56e91bb4a91998002ae36952937~mv2.jpg",
    "https://static.wixstatic.com/media/1620784f39b74c3bb39c58c02a26acb9.jpg",
    "https://static.wixstatic.com/media/11062b_4fb00c7556404b8bad149097d8d73aab~mv2.jpg"
)

$destRoot = Join-Path $PSScriptRoot "..\vendor\static.wixstatic.com"
if(-not (Test-Path $destRoot)) { New-Item -ItemType Directory -Path $destRoot -Force | Out-Null }

foreach($u in $baseUrls){
    try{
        $uri = [Uri]$u
        $path = $uri.AbsolutePath.TrimStart('/')
        $localPath = Join-Path $destRoot $path
        $localDir = Split-Path $localPath -Parent
        if(-not (Test-Path $localDir)){ New-Item -ItemType Directory -Path $localDir -Force | Out-Null }
        Write-Host "Downloading $u -> $localPath"
        Invoke-WebRequest -Uri $u -OutFile $localPath -UseBasicParsing -ErrorAction Stop
    }catch{
        Write-Warning "Failed to download $u : $_"
    }
}

Write-Host "Done. Check vendor/static.wixstatic.com for downloaded assets."