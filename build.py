#!/usr/bin/env python3
"""Assembles the single-file app: src/ui.html + src/engine.js -> dist/vektor.html (zero dependencies).
   python3 build.py --web  ->  also dist/web/: installable online version (GitHub Pages)."""
import json, pathlib, re, shutil, sys
root = pathlib.Path(__file__).resolve().parent
ui = (root / 'src' / 'ui.html').read_text(encoding='utf-8')
engine = (root / 'src' / 'engine.js').read_text(encoding='utf-8')
assert '</script' not in engine, 'engine.js must not contain </script'
assert '/*__ENGINE__*/' in ui
version = re.search(r'Version = "([^"]+)"', (root / 'windows' / 'Setup.cs').read_text(encoding='utf-8')).group(1)
(root / 'dist').mkdir(exist_ok=True)
i18n = {f.stem: json.loads(f.read_text(encoding='utf-8')) for f in sorted((root / 'src' / 'i18n').glob('*.json'))}
i18n_js = json.dumps(i18n, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
assert '/*__I18N__*/{}' in ui
app = ui.replace('/*__I18N__*/{}', i18n_js).replace('/*__ENGINE__*/', engine).replace('__VEKTOR_VERSION__', version)
(root / 'dist' / 'vektor.html').write_text(app.replace('<!--__WEB_HEAD__-->\n', ''), encoding='utf-8')
if '--web' in sys.argv:
    web = root / 'dist' / 'web'
    shutil.rmtree(web, ignore_errors=True); web.mkdir(parents=True)
    head = ('<link rel="manifest" href="manifest.webmanifest">\n<meta name="theme-color" content="#131416">\n'
            '<link rel="apple-touch-icon" href="icon-192.png">\n<meta name="description" content="Turns an image into SVG decals for Gran Turismo 7, under 15,360 bytes per file.">')
    (web / 'index.html').write_text(app.replace('<!--__WEB_HEAD__-->', head), encoding='utf-8')
    for f in (root / 'web').iterdir():
        if f.is_file(): shutil.copy(f, web / f.name)
    print('dist/web/')
print('dist/vektor.html', version)
