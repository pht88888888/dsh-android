#!/system/bin/sh
U=/data/data/com.dsharnessmobile.shell/files
echo "== current dsh =="
ls -la $U/usr/bin/dsh
echo "== backup =="
mv $U/usr/bin/dsh $U/usr/bin/dsh.bak
echo "== write wrapper =="
cat > $U/usr/bin/dsh << 'WRAPPER'
#!/system/bin/sh
# dsh-android wrapper: dsh -> node bin.js (termux-exec hook compat)
exec /data/data/com.dsharnessmobile.shell/files/usr/bin/node   /data/data/com.dsharnessmobile.shell/files/usr/lib/node_modules/@deepseek-ai/dsh/lib/bin.js "$@"
WRAPPER
chmod 755 $U/usr/bin/dsh
echo "== verify =="
ls -la $U/usr/bin/dsh
head -c 200 $U/usr/bin/dsh
echo ""
echo "== test exec =="
dsh --version 2>&1
echo "exit: $?"
echo "== done =="
