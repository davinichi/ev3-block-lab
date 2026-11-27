#!/bin/bash
# No SD writes, uploads, source patching or recursive cleaning occur here.
set -eu
if [ "$#" != 1 ]; then echo 'Usage: bash build_os.sh /cygdrive/c/EV3RT/hrp3-copy'; exit 1; fi
scripts=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$1" && pwd)
case "$root" in *' '*) echo 'STOP: use a source path without spaces.'; exit 1;; esac
bash "$scripts/check_build_env.sh"
test -f "$root/arch/arm_gcc/common/core_support.S"
test -f "$root/sdk/firmware/loader/Makefile.inc"
test -f "$root/sdk/firmware/Makefile"
grep -F 'Keep SPSR_svc intact until the atomic exception return.' "$root/arch/arm_gcc/common/core_support.S" >/dev/null || { echo 'STOP: run the verified source patch check/apply first.'; exit 1; }
if [ -d "$root/sdk/OBJ" ]; then
  echo 'STOP: sdk/OBJ exists. Use a fresh source copy without generated objects; this script never deletes it.'
  exit 1
fi
if [ -f "$root/sdk/common/library/libkernel.a" ]; then
  echo 'STOP: prebuilt libkernel.a exists. Use a fresh source copy with no generated library.'
  exit 1
fi
cd "$root/sdk/firmware"
if [ -e uImage ]; then echo 'STOP: uImage already exists; use a fresh build copy.'; exit 1; fi
make PWD=. img=loader
test -s uImage
echo 'Created sdk/firmware/uImage. Verify its header/CRC and ret_svc_1 disassembly before using a spare SD.'
