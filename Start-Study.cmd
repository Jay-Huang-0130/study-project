@echo off
setlocal
set "STUDY_APP=%LOCALAPPDATA%\Programs\study-project\Study Project.exe"
if not exist "%STUDY_APP%" set "STUDY_APP=%~dp0release\app-0.10.1\Study Project.exe"
if not exist "%STUDY_APP%" set "STUDY_APP=%~dp0release\win-unpacked\Study Project.exe"
if not exist "%STUDY_APP%" set "STUDY_APP=%~dp0release\Study-Project-0.10.1-Windows.exe"
if not exist "%STUDY_APP%" (
  echo Please build Study Project first: npm ci ^&^& npm run package
  pause
  exit /b 1
)
set "STUDY_DATA_DIR=%~dp0release\StudyProjectData"
if exist "%~dp0release\data-location.txt" set /p STUDY_DATA_DIR=<"%~dp0release\data-location.txt"
start "" "%STUDY_APP%" "--study-data-dir=%STUDY_DATA_DIR%"
endlocal
