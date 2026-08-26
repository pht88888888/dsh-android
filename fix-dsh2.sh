#!/system/bin/sh
U=/data/data/com.dsharnessmobile.shell/files
cat /data/local/tmp/dsh-wrapper > $U/usr/bin/dsh
chmod 755 $U/usr/bin/dsh
echo "== verify =="
ls -la $U/usr/bin/dsh
head -c 160 $U/usr/bin/dsh
echo ""
echo "== test exec dsh --version =="
dsh --version 2>&1
echo "exit: $?"
echo "== done =="
