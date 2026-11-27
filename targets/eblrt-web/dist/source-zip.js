// Dependency-free ZIP (stored entries, UTF-8). Used only for source downloads.
export function sourceZip(files) {
  const encode = s => new TextEncoder().encode(s);
  const crc = bytes => {
    let n = 0xffffffff;
    for (const b of bytes) { n ^= b; for (let i=0;i<8;i++) n = (n>>>1)^((n&1)?0xedb88320:0); }
    return (n^0xffffffff)>>>0;
  };
  const header = size => {const data=new Uint8Array(size);return {data,view:new DataView(data.buffer)};};
  const parts=[],directory=[];let offset=0;
  for (const [name,content] of Object.entries(files)) {
    if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(name) || name.split('/').some(p=>p==='.'||p==='..')) throw Error('Invalid source archive path');
    const path=encode(name),body=encode(content),sum=crc(body),local=header(30),central=header(46);
    const l=local.view,c=central.view;
    l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x800,true);l.setUint16(12,33,true);
    l.setUint32(14,sum,true);l.setUint32(18,body.length,true);l.setUint32(22,body.length,true);l.setUint16(26,path.length,true);
    c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint16(14,33,true);
    c.setUint32(16,sum,true);c.setUint32(20,body.length,true);c.setUint32(24,body.length,true);c.setUint16(28,path.length,true);c.setUint32(42,offset,true);
    parts.push(local.data,path,body);directory.push(central.data,path);offset+=30+path.length+body.length;
  }
  const size=directory.reduce((n,b)=>n+b.length,0),end=header(22),count=Object.keys(files).length;
  end.view.setUint32(0,0x06054b50,true);end.view.setUint16(8,count,true);end.view.setUint16(10,count,true);end.view.setUint32(12,size,true);end.view.setUint32(16,offset,true);
  const result=new Uint8Array(offset+size+22);let pos=0;
  for(const part of [...parts,...directory,end.data]) {result.set(part,pos);pos+=part.length;}
  return result;
}
