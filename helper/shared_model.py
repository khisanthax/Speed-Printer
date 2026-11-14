"""One private, immutable project arrangement shared by every comparison slice."""
import hashlib
import io
import json
import math
from pathlib import Path
from pathlib import PurePosixPath
import tempfile
import xml.etree.ElementTree as ET
import zipfile


def layout_signature(data):
    """Hash meshes, copies/transforms, plate membership and object overrides, not printer metadata."""
    def local(name): return name.split('}')[-1]
    identity=(1.,0.,0.,0.,1.,0.,0.,0.,1.,0.,0.,0.)
    def transform(text):
        values=tuple(float(n) for n in text.split()) if text else identity
        if len(values)!=12 or not all(math.isfinite(n) for n in values):raise ValueError('Invalid project transform')
        return values
    def point(vertex,t):
        x,y,z=vertex
        return (x*t[0]+y*t[3]+z*t[6]+t[9],x*t[1]+y*t[4]+z*t[7]+t[10],x*t[2]+y*t[5]+z*t[8]+t[11])
    records=[]; count=0
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        models={name:ET.fromstring(archive.read(name)) for name in archive.namelist() if name.endswith('.model')}
        resources={name:{o.get('id'):o for e in root if local(e.tag)=='resources' for o in e if local(o.tag)=='object'} for name,root in models.items()}
        def meshes(filename,object_id,chain,stack=()):
            key=(filename,object_id)
            if key in stack:raise ValueError('Project component cycle')
            obj=resources[filename][object_id];result=[]
            for child in obj:
                if local(child.tag)=='mesh':
                    vertices=[];triangles=[]
                    for section in child:
                        if local(section.tag)=='vertices':
                            for v in section:
                                xyz=tuple(float(v.get(k,'0')) for k in ('x','y','z'))
                                for t in chain:xyz=point(xyz,t)
                                if not all(math.isfinite(n) for n in xyz):raise ValueError('Invalid project vertex')
                                vertices.append(tuple(round(n,7) for n in xyz))
                        elif local(section.tag)=='triangles':
                            triangles=[sorted((local(k),v) for k,v in triangle.attrib.items()) for triangle in section]
                    result.append(hashlib.sha256(json.dumps([vertices,triangles]).encode()).hexdigest())
                elif local(child.tag)=='components':
                    for component in child:
                        ref=next((v for k,v in component.attrib.items() if local(k)=='path'),filename)
                        if ref.startswith('/'):ref=ref.lstrip('/')
                        elif ref not in models:ref=str(PurePosixPath(filename).parent/ref)
                        result.extend(meshes(ref,component.get('objectid'),(transform(component.get('transform')),*chain),(*stack,key)))
            return result
        instances=[]
        for name,root in models.items():
            if root.get('unit','millimeter')!='millimeter':raise ValueError('Export the comparison project in millimeters')
            for build in root:
                if local(build.tag)!='build':continue
                for item in build:
                    if item.get('printable','1')=='0':continue
                    instances.append(sorted(meshes(name,item.get('objectid'),(transform(item.get('transform')),))))
                    count+=1
        records.append(['world-space printable instances',sorted(instances)])
        for name in sorted(archive.namelist()):
            if name=='Metadata/model_settings.config':
                root=ET.fromstring(archive.read(name))
                # Keep per-object/part print overrides and plate membership. Printer
                # defaults, previews and slice-derived volume statistics are not conditions.
                objects=[]
                for obj in root.findall('object'):
                    parts=[]
                    for part in [obj,*obj.findall('part')]:
                        values=sorted((m.get('key'),m.get('value')) for m in part.findall('metadata')
                                      if m.get('key') and m.get('key') not in ('name','matrix') and not m.get('key','').startswith('source_'))
                        parts.append([part.tag,part.get('id'),values,part.get('subtype')])
                    objects.append(parts)
                objects.sort(key=lambda parts:int(parts[0][1]))
                plates=[]
                for plate in root.findall('plate'):
                    instances=[sorted((m.get('key'),m.get('value')) for m in instance.findall('metadata') if m.get('key') in ('object_id','instance_id')) for instance in plate.findall('model_instance')]
                    plates.append(sorted(instances))
                records.append([name,objects,plates])
            elif name in ('Metadata/layer_config_ranges.xml','Metadata/custom_gcode_per_layer.xml'):
                records.append([name,ET.canonicalize(archive.read(name).decode('utf-8'))])
    if not count:
        raise ValueError('Common project has no printable instances')
    return hashlib.sha256(json.dumps(records,sort_keys=True).encode()).hexdigest(),count


def common_rectangle(bundles):
    """Conservative common area for the demonstrated rectangular printer beds."""
    boxes=[]
    for bundle in bundles:
        points=[tuple(float(n) for n in p.split('x')) for p in bundle['machine'].get('printable_area',[])]
        if len(points)!=4:
            raise ValueError('A common layout needs rectangular printable areas for both printers. Review the machine profiles in Orca.')
        xs={p[0] for p in points};ys={p[1] for p in points}
        if len(xs)!=2 or len(ys)!=2 or set(points)!={(x,y) for x in xs for y in ys}:
            raise ValueError('A shared layout requires rectangular printable areas; this bed shape needs review in Orca.')
        boxes.append((min(xs),min(ys),max(xs),max(ys)))
    x0=max(b[0] for b in boxes);y0=max(b[1] for b in boxes)
    x1=min(b[2] for b in boxes);y1=min(b[3] for b in boxes)
    if x1<=x0 or y1<=y0: raise ValueError('Printer beds have no shared printable area')
    return [f'{x:g}x{y:g}' for x,y in ((x0,y0),(x1,y0),(x1,y1),(x0,y1))]


class SharedModel:
    def __init__(self,path,bundles):
        self.directory=tempfile.TemporaryDirectory(prefix='speed-printer-common-')
        self.original=Path(self.directory.name)/('original'+Path(path).suffix.lower())
        self.original.write_bytes(Path(path).read_bytes())
        self.area=common_rectangle(bundles)
        self.layout=Path(self.directory.name)/'common.3mf'
        self.signature=None;self.object_count=None;self.notes=[]

    def __del__(self):
        if hasattr(self,'directory'):self.directory.cleanup()

    def slice_input(self,bundle):
        # Orca automatically recenters imported 3MF instances when the embedded
        # bed dimensions differ from --load-settings, even with --arrange 0.
        # Match only the embedded coordinate frame to the real selected machine;
        # do not touch meshes, transforms or object/process overrides.
        dest=io.BytesIO()
        with zipfile.ZipFile(self.layout) as source,zipfile.ZipFile(dest,'w') as output:
            for entry in source.infolist():
                data=source.read(entry)
                if entry.filename=='Metadata/project_settings.config':
                    config=json.loads(data)
                    for key in ('printable_area','printable_height','bed_exclude_area'):
                        if key in bundle['machine']: config[key]=bundle['machine'][key]
                    data=json.dumps(config).encode('utf-8')
                output.writestr(entry,data)
        return dest.getvalue()
