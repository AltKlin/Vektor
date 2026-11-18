#!/usr/bin/env bash
# Builds dist/Vektor-Setup.exe and dist/Vektor-Windows.zip from Linux, macOS or WSL.
# Requirements: python3 and the Mono C# compiler (mono-mcs + libmono-system-windows-forms4.0-cil packages).
set -euo pipefail
cd "$(dirname "$0")"
VERSION=$(sed -n 's/.*public const string Version = "\([0-9.]*\)".*/\1/p' windows/Setup.cs)
python3 build.py
# Compiled against the .NET Framework 4.7.2 reference assemblies (not Mono's library):
# an API missing on Windows (e.g. String.TrimEnd(char)) fails the build instead of crashing on the user's machine.
REFS="${VEKTOR_REFS:-.cache/refs/net472}"
if [ ! -f "$REFS/mscorlib.dll" ]; then
  mkdir -p .cache/refs
  curl -fsSL -o .cache/refs/net472.nupkg https://api.nuget.org/v3-flatcontainer/microsoft.netframework.referenceassemblies.net472/1.0.3/microsoft.netframework.referenceassemblies.net472.1.0.3.nupkg
  python3 - <<'PY'
import zipfile, pathlib
out = pathlib.Path('.cache/refs/net472'); out.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile('.cache/refs/net472.nupkg') as z:
    for n in z.namelist():
        if n.startswith('build/.NETFramework/v4.7.2/') and n.endswith('.dll') and n.count('/') == 3:
            (out / n.rsplit('/', 1)[1]).write_bytes(z.read(n))
PY
fi
NETFX=(-nostdlib -noconfig "-lib:$REFS" -r:mscorlib.dll -r:System.dll -r:System.Core.dll -r:System.Drawing.dll -r:System.Windows.Forms.dll)
# Window engine: WebView2 (official Microsoft SDK, pinned version)
WV2=1.0.4314.35; WVD=".cache/webview2-$WV2"
if [ ! -f "$WVD/Microsoft.Web.WebView2.WinForms.dll" ]; then
  mkdir -p "$WVD"
  curl -fsSL -o "$WVD/wv2.nupkg" "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$WV2/microsoft.web.webview2.$WV2.nupkg"
  python3 - "$WVD" <<'PY'
import zipfile, pathlib, sys
d = pathlib.Path(sys.argv[1])
with zipfile.ZipFile(d / 'wv2.nupkg') as z:
    for n in ['lib/net462/Microsoft.Web.WebView2.Core.dll', 'lib/net462/Microsoft.Web.WebView2.WinForms.dll']:
        (d / n.rsplit('/', 1)[1]).write_bytes(z.read(n))
    for a in ['x64', 'x86', 'arm64']:
        (d / f'WebView2Loader-{a}.dll').write_bytes(z.read(f'runtimes/win-{a}/native/WebView2Loader.dll'))
PY
fi
python3 windows/mkres.py windows/vektor.ico dist/app.res Vektor "$VERSION.0"
python3 windows/mkres.py windows/vektor.ico dist/setup.res Vektor.Setup "$VERSION.0"
mcs -nologo -target:winexe "${NETFX[@]}" "-r:$WVD/Microsoft.Web.WebView2.Core.dll" "-r:$WVD/Microsoft.Web.WebView2.WinForms.dll" -win32res:dist/app.res -out:dist/Vektor.exe windows/Vektor.cs
python3 - <<'PY'
# README with Windows line endings for Notepad
import pathlib
t = pathlib.Path('windows/README.txt').read_text(encoding='utf-8').replace('\r\n', '\n').replace('\n', '\r\n')
pathlib.Path('dist/README.txt').write_bytes(t.encode('utf-8'))
PY
mcs -nologo -target:winexe "${NETFX[@]}" "-r:$WVD/Microsoft.Web.WebView2.Core.dll" "-r:$WVD/Microsoft.Web.WebView2.WinForms.dll" -win32res:dist/setup.res \
  -resource:windows/setup.html,setup.html -resource:dist/vektor.html,vektor.html -resource:windows/vektor.ico,vektor.ico \
  -resource:dist/Vektor.exe,Vektor.exe -resource:dist/README.txt,README.txt \
  "-resource:$WVD/Microsoft.Web.WebView2.Core.dll,Microsoft.Web.WebView2.Core.dll" "-resource:$WVD/Microsoft.Web.WebView2.WinForms.dll,Microsoft.Web.WebView2.WinForms.dll" \
  "-resource:$WVD/WebView2Loader-x64.dll,runtimes/win-x64/native/WebView2Loader.dll" "-resource:$WVD/WebView2Loader-x86.dll,runtimes/win-x86/native/WebView2Loader.dll" "-resource:$WVD/WebView2Loader-arm64.dll,runtimes/win-arm64/native/WebView2Loader.dll" \
  -out:dist/Vektor-Setup.exe windows/Setup.cs
python3 - <<'PY'
import zipfile
with zipfile.ZipFile('dist/Vektor-Windows.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    z.write('dist/Vektor-Setup.exe', 'Vektor/Vektor-Setup.exe')
    z.write('dist/README.txt', 'Vektor/README.txt')
PY
rm -f dist/*.res
echo "Vektor $VERSION -> dist/Vektor-Setup.exe, dist/Vektor-Windows.zip"
