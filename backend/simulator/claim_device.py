"""A stand-in for a starter's module on its first power-up: claims its own AWS IoT certificate with the shared claim certificate.

    python simulator/claim_device.py --serial AJ-0001                       # uses %USERPROFILE%\\.aws\\iot-claim\\ and the endpoint in backend/.env

What it does (the same steps the module's firmware has to do; app/services/claim_flow.py):
    connect as claim-<serial> with the claim certificate -> ask for a certificate (its own new private key stays here) ->
    register the serial -> AWS asks the backend whether this serial is on the factory list and unused -> thing created ->
    save the certificate and key -> reconnect as the thing with the new certificate and subscribe to its command topic.

Needs the one-time AWS setup (scripts/deploy_claim_provisioning.py) and the serial on the factory list (website > batches). A serial can be claimed
ONCE: a second try is refused by the backend. It publishes no readings. The new certificate and key are saved to --out (default
%USERPROFILE%\\.aws\\iot-claimed\\<serial>\\); nothing secret is printed.
"""
import argparse
import os
import ssl
import sys
import threading

import paho.mqtt.client as mqtt

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import settings
from app.services.claim_flow import ClaimFlow, claim_client_id

HOME = os.path.expanduser("~")


def tls_client(client_id: str, ca: str, cert: str, key: str) -> mqtt.Client:
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id)
    client.tls_set(ca_certs=ca, certfile=cert, keyfile=key, tls_version=ssl.PROTOCOL_TLSv1_2)
    return client


def run_claim(flow: ClaimFlow, endpoint: str, ca: str, cert: str, key: str, timeout: float = 30.0) -> None:
    client = tls_client(claim_client_id(flow.serial), ca, cert, key)
    ready, finished = threading.Event(), threading.Event()

    def on_connect(c, userdata, flags, reason, props):
        if reason.is_failure:
            flow.state, flow.error = "failed", f"could not connect with the claim certificate: {reason}"
            finished.set()
            return
        c.subscribe([(topic, 1) for topic in flow.subscriptions()])

    def on_subscribe(c, userdata, mid, reasons, props):
        if not ready.is_set() and all(not getattr(r, "is_failure", False) for r in reasons):
            ready.set()
            for topic, payload in flow.start():
                c.publish(topic, payload, qos=1)

    def on_message(c, userdata, msg):
        for topic, payload in flow.on_message(msg.topic, msg.payload):
            c.publish(topic, payload, qos=1)
        if flow.done:
            finished.set()

    client.on_connect, client.on_subscribe, client.on_message = on_connect, on_subscribe, on_message
    client.connect(endpoint, 8883, keepalive=30)
    client.loop_start()
    try:
        if not finished.wait(timeout) and not flow.done:
            flow.state, flow.error = "failed", "no answer from AWS in time (is the backend reachable from AWS?)"
    finally:
        client.loop_stop()
        client.disconnect()


def save(out_dir: str, flow: ClaimFlow, ca_path: str) -> dict:
    os.makedirs(out_dir, exist_ok=True)
    paths = {"cert": os.path.join(out_dir, "device-certificate.pem.crt"), "key": os.path.join(out_dir, "device-private.pem.key")}
    with open(paths["cert"], "w", encoding="ascii", newline="\n") as fh:
        fh.write(flow.certificate_pem)
    with open(paths["key"], "w", encoding="ascii", newline="\n") as fh:
        fh.write(flow.private_key_pem)
    try:
        os.chmod(paths["key"], 0o600)
    except OSError:
        pass
    with open(ca_path, "rb") as src, open(os.path.join(out_dir, "AmazonRootCA1.pem"), "wb") as dst:
        dst.write(src.read())
    return paths


def verify_as_thing(flow: ClaimFlow, endpoint: str, ca: str, paths: dict) -> str:
    """Connect as the thing with the NEW certificate and subscribe to its own command topic: proves the identity works. Publishes nothing."""
    client = tls_client(flow.thing_name, ca, paths["cert"], paths["key"])
    result, done = {}, threading.Event()

    def on_connect(c, u, flags, reason, props):
        result["connect"] = str(reason)
        if reason.is_failure:
            done.set()
        else:
            c.subscribe(f"devices/{flow.thing_name}/commands", qos=1)

    def on_subscribe(c, u, mid, reasons, props):
        result["subscribe"] = [str(r) for r in reasons]
        done.set()

    client.on_connect, client.on_subscribe = on_connect, on_subscribe
    client.connect(endpoint, 8883, keepalive=30)
    client.loop_start()
    try:
        done.wait(15)
    finally:
        client.loop_stop()
        client.disconnect()
    return f"connect={result.get('connect')} subscribe={result.get('subscribe')}"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--serial", required=True, help="the starter ID (the module's own id; on the factory list)")
    ap.add_argument("--claim-dir", default=os.path.join(HOME, ".aws", "iot-claim"))
    ap.add_argument("--out", help="where to save the new certificate and key")
    ap.add_argument("--template", default="agripump-fleet")
    ap.add_argument("--endpoint", default=settings.IOT_DATA_ENDPOINT)
    ap.add_argument("--root-ca", help="AmazonRootCA1.pem (default: the one saved next to the claim certificate)")
    args = ap.parse_args()

    cert = os.path.join(args.claim_dir, "claim-certificate.pem.crt")
    key = os.path.join(args.claim_dir, "claim-private.pem.key")
    ca = args.root_ca or os.path.join(args.claim_dir, "AmazonRootCA1.pem")
    missing = [p for p in (cert, key, ca) if not os.path.isfile(p)]
    if missing or not args.endpoint:
        print("Missing: " + ", ".join(missing or ["IOT_DATA_ENDPOINT (backend/.env)"]) + "\nRun scripts/deploy_claim_provisioning.py first, and copy AmazonRootCA1.pem next to the claim certificate.")
        return 2

    out = args.out or os.path.join(HOME, ".aws", "iot-claimed", args.serial)
    flow = ClaimFlow(args.serial, args.template)
    print(f"Claiming a certificate for {args.serial} ...")
    run_claim(flow, args.endpoint, ca, cert, key)
    if flow.state != "done":
        print(f"FAILED: {flow.error}")
        return 1
    paths = save(out, flow, ca)
    print(f"Claimed. Thing name: {flow.thing_name}. Certificate id: {flow.certificate_id[:12]}...  Saved in {out}")
    print("Reconnecting as the thing with its new certificate: " + verify_as_thing(flow, args.endpoint, ca, paths))
    return 0


if __name__ == "__main__":
    sys.exit(main())
