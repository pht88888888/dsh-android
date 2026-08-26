#!/system/bin/sh
U=/data/data/com.dsharnessmobile.shell/files
echo "== ELF strings in termux-exec =="
grep -a -o -E ".{0,40}ELF.{0,60}" $U/usr/lib/libtermux-exec-ld-preload.so | head -20
echo "== env binary =="
ls -la $U/usr/bin/env 2>&1
echo "== node bin =="
ls -la $U/usr/bin/node 2>&1
echo "== done =="
