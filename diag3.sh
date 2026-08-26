#!/system/bin/sh
echo "== linker64 ELF magic strings =="
grep -a -o -E ".{0,30}ELF magic.{0,40}" /apex/com.android.runtime/bin/linker64 2>/dev/null | head
grep -a -o -E ".{0,30}bad ELF.{0,40}" /apex/com.android.runtime/bin/linker64 2>/dev/null | head
echo "== libdl / libc =="
grep -a -o -E ".{0,30}bad ELF.{0,40}" /system/lib64/libdl.so 2>/dev/null | head
echo "== done =="
