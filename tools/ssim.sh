#!/bin/bash
# usage: tools/ssim.sh a.png b.png  -> prints "SSIM_all PSNR"
s=$(ffmpeg -v info -i "$1" -i "$2" -lavfi "[0]format=yuv420p[a];[1]format=yuv420p[b];[a][b]ssim" -f null - 2>&1 | grep -o "All:[0-9.]*" | cut -d: -f2)
p=$(ffmpeg -v info -i "$1" -i "$2" -lavfi "[0]format=yuv420p[a];[1]format=yuv420p[b];[a][b]psnr" -f null - 2>&1 | grep -o "average:[0-9.inf]*" | cut -d: -f2)
echo "$s $p"
