#!/system/bin/sh
U=/data/data/com.dsharnessmobile.shell/files
echo "== direct exec wrapper =="
$U/usr/bin/dsh --version 2>&1
echo "exit: $?"
echo "== ls -Z context =="
ls -Z $U/usr/bin/dsh 2>&1
ls -Z $U/usr/bin/pnpm 2>&1
ls -Z $U/usr/bin/node 2>&1
echo "== via /system/bin/sh =="
/system/bin/sh $U/usr/bin/dsh --version 2>&1
echo "exit: $?"
echo "== done =="
