#!/bin/sh
set -e

BIN=/usr/lib/postgresql/17/bin/pg_dump
DEST=/app/vendor-pg17

mkdir -p "$DEST"
cp "$BIN" "$DEST/pg_dump"
chmod +x "$DEST/pg_dump"

ldd "$BIN" | awk '{print $3}' | grep '^/' | while read -r lib; do
  cp -L "$lib" "$DEST/"
done

echo "copied pg_dump + $(ls "$DEST" | wc -l) files to $DEST"
