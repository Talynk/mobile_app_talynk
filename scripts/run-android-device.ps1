param(
  [string]$Device = ""
)

$ErrorActionPreference = "Stop"

$jdk = "C:\Program Files\Android\Android Studio\jbr"
$java = Join-Path $jdk "bin\java.exe"

if (-not (Test-Path $java)) {
  throw "Java was not found at $java. Install Android Studio or a JDK, then update this script."
}

$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:GRADLE_OPTS = "-Djava.net.preferIPv4Stack=true -Djava.net.preferIPv6Addresses=false"
$env:NODE_ENV = "development"
$env:Path = "$jdk\bin;$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator;$env:Path"

Write-Host "Using JAVA_HOME=$env:JAVA_HOME"
Write-Host "Using ANDROID_HOME=$env:ANDROID_HOME"
& $java --version

if ([string]::IsNullOrWhiteSpace($Device)) {
  npx expo run:android --device
} else {
  npx expo run:android --device $Device
}
