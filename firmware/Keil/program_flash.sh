#!/bin/bash

# The firmware file path. like: aaa/bbb/ccc/fw.hex
HEX_PATH=$1

# Tools paths
OPENOCD="C:/Program Files (x86)/Nuvoton Tools/OpenOCD/bin/openocd.exe"
SCRIPTS="C:/Program Files (x86)/Nuvoton Tools/OpenOCD/scripts"

# Do some compatibility work for both windows and linux.
if uname | grep -qi 'mingw' || uname | grep -qi 'msys' || uname | grep -qi 'cygwin'; then
    # Windows/Git Bash here
    HEX_PATH=$(echo "$HEX_PATH" | sed 's/\\/\//g')
fi

echo "=========================="
echo "- FLASHING FILE: ${HEX_PATH}"
echo "=========================="

# Run OpenOCD
"$OPENOCD" -s "$SCRIPTS" -f interface/nulink.cfg -f target/numicroM0.cfg -c "program {${HEX_PATH}} verify reset exit"

if [ $? -eq 0 ]; then
    echo "=========================="
    echo "- [SUCCESS] Flash OK"
    echo "=========================="
else
    echo "=========================="
    echo "- [ERROR] Flash Failed"
    echo "=========================="
    exit 1
fi

# Keep window open if run from terminal
read -p "Press [Enter] to close..."
