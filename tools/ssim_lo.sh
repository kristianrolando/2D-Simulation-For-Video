#!/bin/bash
# composition similarity: SSIM on 135x240 heavily blurred, content region only (y 150..1500)
ffmpeg -v info -i "$1" -i "$2" -lavfi "[0]crop=1080:1350:0:150,scale=135:169,gblur=sigma=2,format=gray[a];[1]crop=1080:1350:0:150,scale=135:169,gblur=sigma=2,format=gray[b];[a][b]ssim" -f null - 2>&1 | grep -o "All:[0-9.]*" | cut -d: -f2
