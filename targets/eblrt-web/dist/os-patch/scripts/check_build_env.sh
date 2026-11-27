#!/bin/bash
# Run in the Cygwin shell configured for the chosen complete OS source.
set -eu
failed=0
for tool in make perl ruby arm-none-eabi-gcc arm-none-eabi-objcopy arm-none-eabi-objdump mkimage diff find sed awk grep cp chmod uname; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'MISSING: %s\n' "$tool"
    failed=1
  fi
done
if [ "$failed" != 0 ]; then
  echo 'STOP: install/select the missing OS build tools. EBL-RT application compilation alone is insufficient.'
  exit 1
fi
make --version | head -n 1
perl -e 'print "Perl $^V\n"'
ruby --version
arm-none-eabi-gcc --version | head -n 1
mkimage -V
echo 'Tool presence checked. This does not validate the source tree or generated OS.'
