#!/system/bin/sh
U=/data/data/com.dsharnessmobile.shell/files
echo "== all readable strings in termux-exec =="
grep -a -o -E "[A-Za-z_./%]{8,80}" $U/usr/lib/libtermux-exec-ld-preload.so | sort -u | head -60
echo "== done =="
