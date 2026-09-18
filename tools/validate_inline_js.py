from pathlib import Path
import re, subprocess, tempfile, os, sys

html=Path('index.html').read_text(encoding='utf-8')
blocks=re.findall(r'<script\b([^>]*)>(.*?)</script\s*>', html, flags=re.I|re.S)
checked=0
skipped=0
errors=[]
for i,(attrs,code) in enumerate(blocks,1):
    if re.search(r'\bsrc\s*=',attrs,re.I):
        skipped+=1; continue
    m=re.search(r'\btype\s*=\s*["\']([^"\']+)["\']',attrs,re.I)
    typ=(m.group(1).strip().lower() if m else '')
    if typ and typ not in ('text/javascript','application/javascript','module'):
        skipped+=1; continue
    suffix='.mjs' if typ=='module' else '.js'
    fd,path=tempfile.mkstemp(prefix=f'inline-{i}-',suffix=suffix)
    try:
        with os.fdopen(fd,'w',encoding='utf-8') as f: f.write(code)
        r=subprocess.run(['node','--check',path],capture_output=True,text=True)
        checked+=1
        if r.returncode:
            ident=(re.search(r'\bid\s*=\s*["\']([^"\']+)["\']',attrs,re.I) or [None,f'#{i}'])[1]
            errors.append((ident,r.stderr[-3000:]))
    finally:
        try: os.remove(path)
        except OSError: pass
print(f'INLINE_JS checked={checked} skipped={skipped} total_script_tags={len(blocks)}')
if errors:
    for ident,msg in errors:
        print('SYNTAX_ERROR',ident,msg,sep='\n')
    sys.exit(1)
print('INLINE_JS_SYNTAX_OK')
