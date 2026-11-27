"""Read-only verification of an EV3RT legacy U-Boot uImage."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys
import zlib

KNOWN = {
 'c6f7a29d889eef6a6fc3383cd5792ae832048e68b20d4e16a5a648780d832237': 'previously tested original OS',
 '7bc4d93b0b17a58c47e1f96e08035ff7f25405e7d7275c2f0e892140d38521de': 'previously tested experimental patched OS',
}

def verify(file):
    data = file.read_bytes()
    if len(data) < 64:
        raise ValueError('Truncated header')
    magic, hcrc, timestamp, size, load, entry, dcrc, os_id, arch, image_type, compression, name = struct.unpack('>7I4B32s', data[:64])
    if magic != 0x27051956 or len(data) != 64 + size:
        raise ValueError('Magic or exact data size mismatch')
    header = data[:4] + b'\0'*4 + data[8:64]
    if zlib.crc32(header) & 0xffffffff != hcrc or zlib.crc32(data[64:]) & 0xffffffff != dcrc:
        raise ValueError('Header or data CRC mismatch')
    if (load, entry, os_id, arch, image_type, compression) != (0xc0008000, 0xc0008000, 5, 2, 2, 0):
        raise ValueError('Unexpected EV3RT ARM image settings')
    sha = hashlib.sha256(data).hexdigest()
    return {'header_and_data_crc':'PASS','bytes':len(data),'sha256':sha,
            'known_image':KNOWN.get(sha,'unknown build; CRC success does not confirm patch or compatibility'),
            'load':hex(load),'entry':hex(entry),'timestamp':timestamp,
            'name':name.rstrip(b'\0').decode('ascii',errors='replace')}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('uimage',type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.uimage),indent=2))
    except (OSError,ValueError,struct.error) as error:
        print('STOP:',error,file=sys.stderr)
        sys.exit(1)
