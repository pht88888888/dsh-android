#!/system/bin/sh
# Prepare ppt-master on Android.
# Native extensions come from Termux Android packages, never PyPI wheels.
set -e
PREFIX="${PREFIX:?PREFIX is required}"
export PATH="$PREFIX/bin:$PATH"

pkg install -y python python-lxml python-pillow
"$PREFIX/bin/pip" install --quiet python-pptx svglib reportlab Flask

python3 -c 'from flask import Flask; from lxml import etree; from PIL import Image; from pptx import Presentation; print("ppt-master Android environment ready")'
