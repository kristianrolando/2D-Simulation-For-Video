#!/bin/sh
# Audio fingerprint of rendered videos: integrated loudness and spectral shape (means over 46 ms frames).
#   sh tools/audio-compare.sh output/styles/*.mp4
printf '| file | LUFS | centroid Hz | rolloff Hz | flatness | flux |\n|---|---|---|---|---|---|\n'
for f in "$@"; do
  lufs=$(ffmpeg -hide_banner -nostats -i "$f" -af ebur128 -f null - 2>&1 | awk '/I:/{v=$2} END{print v}')
  ffmpeg -hide_banner -nostats -i "$f" -af "pan=mono|c0=0.5*c0+0.5*c1,aspectralstats=win_size=2048:measure=centroid+rolloff+flatness+flux,ametadata=print:file=-" -f null - 2>/dev/null \
    | awk -F= -v f="$(basename "$f")" -v l="$lufs" '/centroid/{c+=$2;n++} /rolloff/{r+=$2} /flatness/{fl+=$2} /flux/{fx+=$2} END{printf "| %s | %s | %.0f | %.0f | %.3f | %.4f |\n", f, l, c/n, r/n, fl/n, fx/n}'
done
