#!/usr/bin/env python3
import json
import re
import sys
from statistics import median

log_path, report_path = sys.argv[1], sys.argv[2]
text = open(log_path, encoding="utf-8", errors="replace").read()
lines_in = text.splitlines()


def extract_json_payload(line, event):
    marker = f"[FeedTelemetry] {event} "
    if marker not in line:
        return None
    payload = line.split(marker, 1)[1].strip()
    if not payload.startswith("{"):
        return None
    try:
        return json.loads(payload)
    except json.JSONDecodeError:
        return None


def extract_number(line, key):
    match = re.search(rf"{key}['\"]?\s*:\s*'?(\d+)", line)
    if match:
        return int(match.group(1))
    match = re.search(rf'"{key}"\s*:\s*(\d+)', line)
    if match:
        return int(match.group(1))
    return None


def extract_string(line, key):
    match = re.search(rf"{key}['\"]?\s*:\s*'([^']+)'", line)
    if match:
        return match.group(1)
    match = re.search(rf'"{key}"\s*:\s*"([^"]+)"', line)
    if match:
        return match.group(1)
    return "unknown"


entries = []
for line in lines_in:
    payload = extract_json_payload(line, "video_time_to_first_frame_ms")
    if not payload:
        continue
    duration = payload.get("durationMs")
    post_id = payload.get("postId", "unknown")
    if not isinstance(duration, int):
        continue
    entries.append((str(post_id), duration))

scrolls = []
for line in lines_in:
    payload = extract_json_payload(line, "feed_scroll_settled")
    if not payload:
        continue
    index = payload.get("index")
    direction = payload.get("direction", "unknown")
    if isinstance(index, int):
        scrolls.append((index, str(direction)))

pull_refresh = len(re.findall(r"feed_pull_to_refresh", text))
warnings = len(re.findall(r"More than one fullscreen player mounted", text))
player_counts = []
for line in lines_in:
    payload = extract_json_payload(line, "active_feed_players_count")
    if not payload:
        continue
    count = payload.get("count")
    if isinstance(count, int):
        player_counts.append(count)
max_players = max(player_counts) if player_counts else 0

lines = [
    "",
    "=== SCROLL VERIFICATION ===",
    f"  feed_scroll_settled: {len(scrolls)}",
    f"  pull_to_refresh (bad): {pull_refresh}",
    f"  max players: {max_players} | dual warnings: {warnings}",
]
if scrolls:
    indices = [index for index, _ in scrolls]
    directions = [direction for _, direction in scrolls]
    lines.append(f"  index sequence: {','.join(str(index) for index in indices)}")
    lines.append(f"  index min/max: {min(indices)} -> {max(indices)}")
    lines.append(f"  directions: {directions.count('forward')} forward | {directions.count('backward')} backward")

lines.append("")
lines.append(f"=== VIDEO STARTS: {len(entries)} ===")
if not entries:
    lines.append("FAIL: no video telemetry")
else:
    durs = [d for _, d in entries]
    over_1s = [d for d in durs if d > 1000]
    over_3s = [d for d in durs if d > 3000]
    lines.append(
        f"  min={min(durs)} max={max(durs)} avg={sum(durs) // len(durs)} median={median(durs):.0f}ms"
    )
    lines.append(f"  >1s: {len(over_1s)}/{len(entries)} | >3s: {len(over_3s)}/{len(entries)}")
    lines.append("")
    for i, (pid, d) in enumerate(entries, 1):
        flag = " FAIL" if d > 1000 else ""
        lines.append(f"  #{i:3d} {d:5d}ms {pid[:8]}...{flag}")
    even = [durs[i] for i in range(0, len(durs), 2)]
    odd = [durs[i] for i in range(1, len(durs), 2)]
    if even and odd:
        lines.append("")
        lines.append(f"  even avg={sum(even) / len(even):.0f}ms odd avg={sum(odd) / len(odd):.0f}ms")
        if abs(sum(even) / len(even) - sum(odd) / len(odd)) > 1500:
            lines.append("  >>> ALTERNATING PATTERN <<<")
    ok = len(over_1s) == 0 and len(scrolls) >= 30 and max_players <= 1 and pull_refresh == 0
    lines.append("")
    lines.append(f"RESULT: {'PASS' if ok else 'FAIL'}")

out = "\n".join(lines)
print(out)
with open(report_path, "a") as f:
    f.write(out + "\n")
