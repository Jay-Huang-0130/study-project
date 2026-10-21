param([string]$DataDirectory)
$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$releaseRoot = Join-Path $projectRoot 'release'
$application = Get-ChildItem -LiteralPath $releaseRoot -Directory -Filter 'app-*' |
    Where-Object { $_.Name -match '^app-\d+\.\d+\.\d+$' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'Study Project.exe')) } |
    Sort-Object { [Version]$_.Name.Substring(4) } -Descending |
    Select-Object -First 1
if (-not $application -and (Test-Path -LiteralPath (Join-Path $releaseRoot 'win-unpacked/Study Project.exe'))) {
    $application = Get-Item -LiteralPath (Join-Path $releaseRoot 'win-unpacked')
}
if (-not $application) { throw '找不到已解壓的程式。請先建立版本並放入 release/app-版本號/。' }
$targetPath = Join-Path $application.FullName 'Study Project.exe'
$locationFile = Join-Path $releaseRoot 'data-location.txt'
if (-not $DataDirectory -and (Test-Path -LiteralPath $locationFile)) { $DataDirectory = [System.IO.File]::ReadAllText($locationFile).Trim() }
$dataRoot = if ($DataDirectory) { [System.IO.Path]::GetFullPath($DataDirectory) } else { Join-Path $releaseRoot 'StudyProjectData' }
New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
[System.IO.File]::WriteAllText($locationFile,$dataRoot,[System.Text.UTF8Encoding]::new($false))
$desktopRoot = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopRoot 'Study Project.lnk'
$shellObject = New-Object -ComObject WScript.Shell
if (Test-Path -LiteralPath $shortcutPath) {
    $existingShortcut = $shellObject.CreateShortcut($shortcutPath)
    if (-not $existingShortcut.TargetPath.StartsWith($projectRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        $shortcutPath = Join-Path $desktopRoot 'Study Project - study-project.lnk'
    }
}
$shortcut = $shellObject.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.Arguments = '--study-data-dir="' + $dataRoot + '"'
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Description = 'Study Project 個人 PDF 讀書導師'
$shortcut.IconLocation = $targetPath + ',0'
$shortcut.Save()
Write-Output $shortcutPath
