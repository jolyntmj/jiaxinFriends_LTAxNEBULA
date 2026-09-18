from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import io
root=Path(__file__).resolve().parents[1]
source=root/'dist/TrackPlan_Source.zip'
with ZipFile(source,'w',ZIP_DEFLATED) as z:
 for folder in ['dist','scripts','docs','results']:
  for p in sorted((root/folder).rglob('*')):
   if p.is_file() and p!=source and '__pycache__' not in str(p):z.write(p,p.relative_to(root))
 z.write(root/'README.md','README.md')
for target in [source]:
 with ZipFile(target) as z:assert z.testzip() is None
print(source)
