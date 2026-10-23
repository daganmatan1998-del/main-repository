#!/usr/bin/env python3
"""A stand-in for the ringback MCP server, used only by the Rust tests in
src/ringback.rs. One JSON object per line on stdin/stdout.
  --exit-after-init : answer initialize, then exit (a container that died)
  --hang            : answer initialize, then never answer anything again"""
import json, sys

exit_after_init = "--exit-after-init" in sys.argv
hang = "--hang" in sys.argv

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
        if p["name"] == "fail":
            res = {"isError": True, "content": [{"type": "text", "text": "boom"}]}
        else:
            res = {"content": [{"type": "text", "text": "hello " + str(p["arguments"].get("opening_line", ""))}]}
        out = {"jsonrpc": "2.0", "id": mid, "result": res}
    else:
        out = {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "no such method"}}
    sys.stdout.write(json.dumps(out) + "\n"); sys.stdout.flush()
