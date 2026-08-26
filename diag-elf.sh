#!/system/bin/sh
U=/data/data/com.dsharnessmobile.shell/files
echo "== whoami =="; id
echo "== grep bad ELF in node =="
grep -a -c "bad ELF" $U/usr/bin/node
echo "== grep ELF magic in node =="
grep -a -c "ELF magic" $U/usr/bin/node
echo "== grep bad ELF in termux-exec =="
grep -a -c "bad ELF" $U/usr/lib/libtermux-exec-ld-preload.so 2>/dev/null
echo "== grep ELF in termux-exec =="
grep -a -c "ELF" $U/usr/lib/libtermux-exec-ld-preload.so 2>/dev/null
echo "== linker64 =="
ls -la /system/bin/linker64 2>/dev/null || ls -la /system/bin/linker
echo "== bin.js first bytes =="
od -A x -t x1z -N 16 $U/usr/lib/node_modules/@deepseek-ai/dsh/lib/bin.js
echo "== done =="
