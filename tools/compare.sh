#!/bin/bash
# usage: tools/compare.sh <refId> <protoFramesDir> <outPng> t1 t2 ...   (ref | proto pairs, scaled)
ref=$(ls references/*\[$1\]*); dir=$2; outp=$3; shift 3
mkdir -p work/cmp; ins=(); fl=""; n=0
for t in "$@"; do
  ffmpeg -v error -y -ss $t -i "$ref" -frames:v 1 work/cmp/ref_$t.png
  ins+=(-i work/cmp/ref_$t.png -i $dir/t$t.png); n=$((n+2))
done
ffmpeg -v error -y "${ins[@]}" -filter_complex "hstack=inputs=$n,scale=iw/4:ih/4" "$outp"
