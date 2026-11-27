from pathlib import Path
import sys,struct,zlib,json
raw=Path(sys.argv[1]).read_bytes()
if len(raw)<64:raise SystemExit('FAIL: short image')
magic,hcrc,stamp,size,load,entry,dcrc,osid,arch,kind,comp,name=struct.unpack('>7I4B32s',raw[:64])
head=bytearray(raw[:64]);head[4:8]=bytes(4)
checks={'magic':magic==0x27051956,'headerCRC':zlib.crc32(head)==hcrc,'declaredSize':size==len(raw)-64,'dataCRC':zlib.crc32(raw[64:])==dcrc,'ARM':arch==2,'legacyKernel':kind==2 and comp==0,'loadEntry':load==entry==0xc0008000}
print(json.dumps({'checks':checks,'bytes':len(raw),'load':hex(load),'entry':hex(entry),'name':name.split(bytes([0]))[0].decode('ascii','replace')},indent=2))
raise SystemExit(0 if all(checks.values()) else 1)
