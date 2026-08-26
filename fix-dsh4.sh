#!/system/bin/sh
U=/data/data/com.dsharnessmobile.shell/files
export PATH=$U/usr/bin:/system/bin
export LD_LIBRARY_PATH=$U/usr/lib
export LD_PRELOAD=$U/usr/lib/libtermux-exec-ld-preload.so
export TERMUX_EXEC__SYSTEM_LINKER_EXEC__MODE=force
export TERMUX_EXEC__EXECVE_CALL__INTERCEPT=1
export TERMUX__PREFIX=$U/usr
export TERMUX__ROOTFS=$U
export TMPDIR=$U/home/tmp
export OPENSSL_CONF=$U/usr/etc/tls/openssl.cnf
echo "== dsh --version via wrapper (full env) =="
dsh --version 2>&1
echo "exit: $?"
echo "== done =="
