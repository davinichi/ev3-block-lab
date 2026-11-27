"""Apply only the exact, verified HRP3 source change; never touch an SD image."""
import argparse
import hashlib
from pathlib import Path
import sys

OLD = '32b9e53d767f88f6a2e409db4d97c5ac8f1a6732e69599f58a55933d9260d8d4'
NEW = '6fd6b9147af05e2d6ca1333ca9c4437c1960f390a4312895f0b44f2f08d9a3ec'
REL = 'arch/arm_gcc/common/core_support.S'
ADDITION = (b'\t/* Keep SPSR_svc intact until the atomic exception return. An IRQ\n'
            b'\t * returning to SVC may overwrite it if it arrives after MSR SPSR. */\n'
            b'\tmsr\t\tcpsr_c, #(CPSR_SVC_MODE AOR CPSR_FIQ_IRQ_BIT)\n')
ANCHOR = b'ALABEL(ret_svc_1)\n#if __TARGET_ARCH_ARM < 6\n'

def digest(data):
    return hashlib.sha256(data.replace(b'\r\n', b'\n')).hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['check', 'apply', 'revert'])
    parser.add_argument('source_root', type=Path)
    args = parser.parse_args()
    target = args.source_root.resolve() / REL
    data = target.read_bytes()
    state = digest(data)
    backup = target.with_name(target.name + '.pre-ebl-svc-v1.bak')
    if state not in (OLD, NEW):
        raise ValueError('UNKNOWN SOURCE: hash differs; no changes made. Do not force this patch.')
    if args.action == 'check':
        print('ORIGINAL / patch applicable' if state == OLD else 'PATCHED / already applied')
        return
    if args.action == 'apply':
        if state == NEW:
            print('Already patched; unchanged.')
            return
        normal = data.replace(b'\r\n', b'\n')
        assert normal.count(ANCHOR) == 1
        modified = normal.replace(ANCHOR, ANCHOR + ADDITION, 1)
        assert digest(modified) == NEW
        if b'\r\n' in data:
            modified = modified.replace(b'\n', b'\r\n')
        # Exclusive create: a previous backup is never silently overwritten.
        with backup.open('xb') as stream:
            stream.write(data)
        target.write_bytes(modified)
        assert digest(target.read_bytes()) == NEW
        print('APPLIED; original bytes backed up:', backup)
    else:
        if state == OLD:
            print('Already original; unchanged.')
            return
        original = backup.read_bytes()
        if digest(original) != OLD:
            raise ValueError('Backup hash differs; no changes made.')
        target.write_bytes(original)
        assert target.read_bytes() == original
        print('RESTORED exact original bytes. Backup retained.')

if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, AssertionError) as error:
        print('STOP:', error, file=sys.stderr)
        sys.exit(1)
