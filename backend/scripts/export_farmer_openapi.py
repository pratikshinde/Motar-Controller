"""Export the slice of the API the farmer mobile app uses to mobile/openapi/farmer.json.

The mobile app generates its typed client and runtime validators from this file (orval), and CI
regenerates it and fails when it differs from the committed copy, so a backend change that the app
has not caught up with breaks a build instead of showing a blank value on a phone.

Run from backend/:  python scripts/export_farmer_openapi.py
"""
import json
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
logging.disable(logging.CRITICAL)

from app.main import app  # noqa: E402

PREFIX = "/api/v1"

# (method, path under /api/v1) -> operationId used for the generated hook / function name
OPERATIONS = {
    ("post", "/auth/login-password"): "loginWithPassword",
    ("post", "/auth/refresh"): "refreshSession",
    ("post", "/auth/logout"): "logout",
    ("get", "/auth/me"): "getMe",
    ("patch", "/auth/me"): "updateMe",
    ("get", "/auth/me/sessions"): "listSessions",
    ("delete", "/auth/me/sessions/{family_id}"): "revokeSession",
    ("get", "/auth/me/export"): "exportMyData",
    ("get", "/auth/me/deletion-request"): "getDeletionRequest",
    ("post", "/auth/me/deletion-request"): "requestDeletion",
    ("get", "/pumps"): "listPumps",
    ("get", "/pumps/{id}"): "getPump",
    ("patch", "/pumps/{id}/my-settings"): "updatePumpSettings",
    ("post", "/pumps/{id}/commands"): "sendPumpCommand",
    ("get", "/pumps/{id}/commands/{cid}"): "getPumpCommand",
    ("get", "/pumps/{id}/timer"): "getPumpTimer",
    ("put", "/pumps/{id}/timer"): "setPumpTimer",
    ("get", "/pumps/{id}/history"): "getPumpHistory",
    ("get", "/pumps/{id}/faults"): "listPumpFaults",
    ("post", "/pumps/{id}/faults/{fault_id}/ack"): "ackPumpFault",
    ("get", "/pumps/{id}/support-contact"): "getSupportContact",
    ("get", "/alerts"): "listAlerts",
    ("post", "/alerts/{id}/ack"): "ackAlert",
    ("post", "/alerts/{id}/resolve"): "resolveAlert",
    ("get", "/sites"): "listSites",
    ("post", "/sites"): "createSite",
    ("patch", "/sites/{id}"): "updateSite",
    ("delete", "/sites/{id}"): "deleteSite",
}


def refs(node, found):
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "$ref" and isinstance(v, str) and v.startswith("#/components/schemas/"):
                found.add(v.rsplit("/", 1)[1])
            else:
                refs(v, found)
    elif isinstance(node, list):
        for v in node:
            refs(v, found)


def main(out_path: str) -> None:
    full = app.openapi()
    paths = {}
    for (method, path), op_id in OPERATIONS.items():
        item = full["paths"].get(f"{PREFIX}{path}")
        if not item or method not in item:
            raise SystemExit(f"Route missing from the API: {method.upper()} {PREFIX}{path}")
        op = dict(item[method])
        op["operationId"] = op_id
        op["tags"] = ["farmer"]
        paths.setdefault(path, {})[method] = op

    needed, queue = set(), []
    refs(paths, needed)
    queue = list(needed)
    schemas = full.get("components", {}).get("schemas", {})
    while queue:
        name = queue.pop()
        found = set()
        refs(schemas[name], found)
        for f in found - needed:
            needed.add(f)
            queue.append(f)

    spec = {
        "openapi": full["openapi"],
        "info": {"title": "AgriPump farmer app API", "version": full["info"]["version"]},
        "servers": [{"url": PREFIX}],
        "paths": paths,
        "components": {
            "schemas": {n: schemas[n] for n in sorted(needed)},
            "securitySchemes": full.get("components", {}).get("securitySchemes", {}),
        },
    }
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(spec, fh, indent=2, sort_keys=True, ensure_ascii=False)
        fh.write("\n")
    print(f"wrote {out_path}: {len(paths)} paths, {len(needed)} schemas")


if __name__ == "__main__":
    default = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "mobile", "openapi", "farmer.json")
    main(sys.argv[1] if len(sys.argv) > 1 else default)
