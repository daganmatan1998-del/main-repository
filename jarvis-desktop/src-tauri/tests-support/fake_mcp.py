#!/usr/bin/env python3
"""A stand-in for the ringback MCP server, used only by the Rust tests in
src/ringback.rs. One JSON object per line on stdin/stdout.
  --exit-after-init : answer initialize, then exit (a container that died)
  --hang            : answer initialize, then never answer anything again
  --replies a|b|c   : each tools/call (except call_end) answers with the next text,
                      the last one repeating; an empty piece means an empty reply
  --log PATH        : append the name of every tools/call received, one per line"""
import json, sys

exit_after_init = "--exit-after-init" in sys.argv
hang = "--hang" in sys.argv
replies = None
log_path = None
for i, a in enumerate(sys.argv):
    if a == "--replies" and i + 1 < len(sys.argv):
        replies = sys.argv[i + 1].split("|")
    if a == "--log" and i + 1 < len(sys.argv):
        log_path = sys.argv[i + 1]
reply_i = 0

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    msg = json.loads(line)
    if "id" not in msg:
        continue  # notifications/initialized
    method, mid = msg.get("method"), msg["id"]
    if method == "initialize":
        out = {"jsonrpc": "2.0", "id": mid, "result": {
            "protocolVersion": "2024-11-05", "capabilities": {"tools": {}},
            "serverInfo": {"name": "fake-ringback", "version": "0"}}}
        sys.stdout.write(json.dumps(out) + "\n"); sys.stdout.flush()
        if exit_after_init:
            sys.exit(0)
        continue
    if hang:
        continue
    if method == "tools/call":
        p = msg["params"]
        if log_path:
            with open(log_path, "a") as f:
                f.write(p["name"] + "\n")
        if p["name"] == "fail":
            res = {"isError": True, "content": [{"type": "text", "text": "boom"}]}
        elif replies is not None and p["name"] != "call_end":
            text = replies[min(reply_i, len(replies) - 1)]
            reply_i += 1
            res = {"content": [{"type": "text", "text": text}]}
        else:
            res = {"content": [{"type": "text", "text": "hello " + str(p["arguments"].get("opening_line", ""))}]}
        out = {"jsonrpc": "2.0", "id": mid, "result": res}
    else:
        out = {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "no such method"}}
    sys.stdout.write(json.dumps(out) + "\n"); sys.stdout.flush()
