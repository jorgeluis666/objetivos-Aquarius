import sys,json,base64,collections
import pymupdf as fitz
p=json.load(sys.stdin)
d=fitz.open(stream=base64.b64decode(p['pdf']),filetype='pdf')
assert len(d)==16, 'Unexpected PDF pagination'
page=d[2]
t=page.get_text()
assert 'Resumen de leads' in t and 'Evolución de leads' in t and 'Por día' in t
assert 'todavía no está' not in t
expected=collections.Counter(x['color'].lower() for x in p['chart']['lines'])
assert len(expected)==2
drawings=page.get_drawings()
counts={}
for color,n in expected.items():
 rgb=tuple(int(color[i:i+2],16)/255 for i in (1,3,5))
 matches=[a for a in drawings if a.get('color') and all(abs(x-y)<0.015 for x,y in zip(a['color'],rgb)) and any(i[0]=='l' for i in a['items']) and a['rect'].width>5 and a['rect'].x1<page.rect.width*0.53]
 assert len(matches)>=n, 'Printed series is missing segments'
 counts[color]=len(matches)
 # Inspect rendered pixels around every actual vector line, not only SVG markup.
 for a in matches:
  clip=a['rect']+(-2,-2,2,2)
  pix=page.get_pixmap(matrix=fitz.Matrix(2,2),clip=clip,alpha=False)
  samples=pix.samples
  assert any(all(abs(samples[j+k]/255-rgb[k])<0.16 for k in range(3)) for j in range(0,len(samples),3)), 'Series absent from rasterized PDF'
print(json.dumps({'pages':len(d),'chart_page':3,'series':2,'series_segments':counts,'render_passed':True}))
