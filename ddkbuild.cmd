@echo off
setlocal EnableExtensions

:: Project-local WDK7 build wrapper.
::
:: Supported commands:
::   ddkbuild.cmd -WIN7    checked src [build flags]
::   ddkbuild.cmd -WIN7A64 checked src [build flags]
::
:: The old OSR ddkbuild script supported many legacy DDK targets that this
:: repository does not maintain. This wrapper keeps the public command shape
:: used by the README while making the actual behavior small enough to audit.

set "TARGET=%~1"
set "MODE=%~2"
set "BUILD_DIR=%~3"
set "BUILD_FLAGS="

if "%TARGET%" == "" goto :usage
if "%MODE%" == "" goto :usage
if "%BUILD_DIR%" == "" goto :usage

shift
shift
shift

:collect_flags
if "%~1" == "" goto :validate
set "BUILD_FLAGS=%BUILD_FLAGS% %~1"
shift
goto :collect_flags

:validate
call :resolve_arch "%TARGET%"
if errorlevel 1 goto :usage

call :resolve_mode "%MODE%"
if errorlevel 1 goto :usage

call :resolve_wdk
if errorlevel 1 goto :end

if not exist "%BUILD_DIR%\dirs" if not exist "%BUILD_DIR%\sources" (
    echo ddkbuild: "%BUILD_DIR%" does not contain dirs or sources. 1>&2
    exit /b 2
)

call :run_build
goto :end


:resolve_arch
set "SETENV_ARCH="

if /I "%~1" == "-WIN7" (
    set "SETENV_ARCH=x86"
    exit /b 0
)

if /I "%~1" == "-WIN7A64" (
    set "SETENV_ARCH=x64"
    exit /b 0
)

exit /b 1


:resolve_mode
set "SETENV_MODE="

if /I "%~1" == "checked" set "SETENV_MODE=checked"
if /I "%~1" == "chk" set "SETENV_MODE=checked"
if /I "%~1" == "free" set "SETENV_MODE=free"
if /I "%~1" == "fre" set "SETENV_MODE=free"

if "%SETENV_MODE%" == "" exit /b 1

exit /b 0


:resolve_wdk
set "WDK_ROOT="

if defined W7BASE (
    set "WDK_ROOT=%W7BASE%"
)

if "%WDK_ROOT%" == "" if defined WDK_ROOT (
    set "WDK_ROOT=%WDK_ROOT%"
)

if "%WDK_ROOT%" == "" (
    set "WDK_ROOT=C:\WinDDK\7600.16385.1"
)

if not exist "%WDK_ROOT%\bin\setenv.bat" (
    echo ddkbuild: WDK7 setenv.bat not found under "%WDK_ROOT%". 1>&2
    echo ddkbuild: set W7BASE or WDK_ROOT to the WDK7 root. 1>&2
    exit /b 3
)

for %%i in ("%WDK_ROOT%") do set "WDK_ROOT_ARG=%%~fsi"

exit /b 0


:run_build
set "ROOT_DIR=%CD%"
set "BUILD_DIR_ABS=%ROOT_DIR%\%BUILD_DIR%"
set "PREBUILD=%ROOT_DIR%\%BUILD_DIR%\ddkprebld.cmd"

if exist "%PREBUILD%" (
    call "%PREBUILD%"
    if errorlevel 1 exit /b %errorlevel%
)

call "%WDK_ROOT%\bin\setenv.bat" %WDK_ROOT_ARG% %SETENV_MODE% %SETENV_ARCH% WIN7 no_oacr
if errorlevel 1 exit /b %errorlevel%

pushd "%BUILD_DIR_ABS%"
if errorlevel 1 exit /b %errorlevel%

build %BUILD_FLAGS%
set "BUILD_EXIT=%errorlevel%"

popd
exit /b %BUILD_EXIT%


:usage
echo usage: ddkbuild.cmd ^<-WIN7^|-WIN7A64^> ^<checked^|free^> ^<build-dir^> [build flags] 1>&2
exit /b 2


:end
exit /b %errorlevel%
