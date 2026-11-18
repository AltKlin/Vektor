# Generates a Win32 .res (icon + asInvoker/DPI manifest) for mcs -win32res
import struct, sys
ico, out, name, ver = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
def entry(typ, nid, data, flags=0x1030, lang=0):
    hdr = struct.pack('<IIHHHHIHHII', len(data), 32, 0xFFFF, typ, 0xFFFF, nid, 0, flags, lang, 0, 0)
    pad = (4 - len(data) % 4) % 4
    return hdr + data + b'\0' * pad
b = open(ico, 'rb').read()
_, _, n = struct.unpack('<HHH', b[:6])
res = struct.pack('<IIHHHHIHHII', 0, 32, 0xFFFF, 0, 0xFFFF, 0, 0, 0, 0, 0, 0)
grp = struct.pack('<HHH', 0, 1, n)
for i in range(n):
    w, h, cc, r, planes, bits, size, off = struct.unpack('<BBBBHHII', b[6 + 16 * i: 22 + 16 * i])
    res += entry(3, i + 1, b[off:off + size], 0x1010, 0x0409)
    grp += struct.pack('<BBBBHHIH', w, h, cc, r, planes, bits, size, i + 1)
res += entry(14, 32512, grp, 0x1030, 0x0409)
man = f'''<?xml version="1.0" encoding="utf-8"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <assemblyIdentity version="{ver}" name="{name}.app"/>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v2">
    <security>
      <requestedPrivileges xmlns="urn:schemas-microsoft-com:asm.v3">
        <requestedExecutionLevel level="asInvoker" uiAccess="false" />
      </requestedPrivileges>
    </security>
  </trustInfo>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <supportedOS Id="{{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}}" />
    </application>
  </compatibility>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true</dpiAware>
    </windowsSettings>
  </application>
</assembly>
'''.encode('utf-8')
res += entry(24, 1, man, 0x1030, 0x0409)
open(out, 'wb').write(res)
print(out, len(res), 'bytes,', n, 'icons')
