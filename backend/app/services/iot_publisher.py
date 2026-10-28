"""Publishing commands to a pump (P2.4).

The topic and message follow SRS §6.3 (layer B):

    topic    devices/{dev_id}/commands          (QoS 1; the device's IoT policy is scoped to devices/{dev_id}/*)
    message  {"v":1, "cid":"<uuid>", "ts":<epoch>, "actor":"usr_xxxxxxxx", "cmd":"START", "expiry":<epoch>}
             + "params":{...} only for commands that carry values (SET_TIMER, RESET_FAULT)

`{dev_id}` is the pump id: the MCU's id is the MQTT client id and is what `pumps.id` holds.

Which channel is used is `settings.publish_mode()`:
    aws     AWS IoT Core data plane (boto3 `iot-data`, credentials from the environment / instance role)
    outbox  nothing leaves the server; the local simulator collects commands over HTTP (development only)
    both    AWS IoT Core as above AND the outbox, so a simulated pump answers while AWS sees the command (development only)
    off     nothing is sent and the command ends FAILED: the pump was never asked
"""
from __future__ import annotations

import json
import logging
from datetime import timezone
from typing import Any, Dict, Optional, Protocol

from app.config import settings

logger = logging.getLogger("agripump.publisher")

COMMAND_TOPIC = "devices/{dev_id}/commands"


class PublishError(Exception):
    """The command could not be handed to the broker. `code` is a stable, short reason."""

    def __init__(self, code: str, message: str = ""):
        super().__init__(message or code)
        self.code = code


def command_topic(pump_id: str) -> str:
    return COMMAND_TOPIC.format(dev_id=pump_id)


def _epoch(dt) -> int:
    dt = dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp())


def build_envelope(cmd) -> Dict[str, Any]:
    """The message a pump receives for `cmd` (a `Command` row)."""
    message: Dict[str, Any] = {
        "v": 1,
        "cid": str(cmd.cid),
        "ts": _epoch(cmd.issued_at),
        "actor": f"usr_{cmd.actor_id.hex[:8]}" if cmd.actor_id else "system",
        "cmd": cmd.action,
        "expiry": _epoch(cmd.expires_at),
    }
    if cmd.payload:
        message["params"] = cmd.payload
    return message


class Publisher(Protocol):
    def publish(self, topic: str, message: Dict[str, Any]) -> None:
        """Hands `message` to the broker. Raises PublishError if the broker did not take it."""


def apply_network_preference() -> None:
    """IOT_FORCE_IPV4: make urllib3 (which boto3 uses) resolve IPv4 only. Call before the first AWS connection."""
    if settings.IOT_FORCE_IPV4:
        import urllib3.util.connection as urllib3_connection

        urllib3_connection.HAS_IPV6 = False


class AwsIotPublisher:
    """AWS IoT Core data plane. The client is built on first use so the app starts without AWS configured."""

    def __init__(self) -> None:
        self._client = None

    def _get_client(self):
        if self._client is None:
            try:
                apply_network_preference()
                import boto3

                kwargs: Dict[str, Any] = {"region_name": settings.AWS_REGION}
                if settings.IOT_DATA_ENDPOINT:
                    endpoint = settings.IOT_DATA_ENDPOINT
                    kwargs["endpoint_url"] = endpoint if endpoint.startswith("http") else f"https://{endpoint}"
                self._client = boto3.client("iot-data", **kwargs)
            except Exception as exc:
                logger.error("Could not create the AWS IoT Data client: %s", exc)
                raise PublishError("publisher_unavailable", str(exc)) from exc
        return self._client

    def publish(self, topic: str, message: Dict[str, Any]) -> None:
        client = self._get_client()
        try:
            client.publish(topic=topic, qos=1, payload=json.dumps(message, separators=(",", ":")))
        except Exception as exc:  # botocore ClientError, NoCredentialsError, EndpointConnectionError ...
            logger.error("AWS IoT publish to %s failed: %s", topic, exc)
            raise PublishError("publish_failed", str(exc)) from exc


class OutboxPublisher:
    """Development: the broker is the database. The simulator collects SENT commands over HTTP."""

    def publish(self, topic: str, message: Dict[str, Any]) -> None:
        logger.info("Outbox: %s <- %s", topic, message)


class BothPublisher:
    """Development: publishes to AWS IoT Core and also leaves the command in the outbox for the local simulator.

    AWS is tried first and its refusal fails the command, exactly as in `aws` mode. The simulator's answer travels over
    HTTP, not through AWS, so this shows a command reaching AWS but does not prove the return path."""

    def __init__(self, aws: Optional[Publisher] = None) -> None:
        self._aws = aws or AwsIotPublisher()
        self._outbox = OutboxPublisher()

    def publish(self, topic: str, message: Dict[str, Any]) -> None:
        self._aws.publish(topic, message)
        self._outbox.publish(topic, message)


class DisabledPublisher:
    def publish(self, topic: str, message: Dict[str, Any]) -> None:
        raise PublishError("publisher_disabled", "IOT_PUBLISH_MODE is off: no command channel to pumps is configured")


_publisher: Optional[Publisher] = None


def get_publisher() -> Publisher:
    global _publisher
    if _publisher is None:
        mode = settings.publish_mode()
        _publisher = {"aws": AwsIotPublisher, "outbox": OutboxPublisher, "both": BothPublisher, "off": DisabledPublisher}[mode]()
        logger.info("Command publisher: %s", mode)
    return _publisher


def set_publisher(publisher: Optional[Publisher]) -> None:
    """Swap the publisher (tests, or a different transport). None restores the configured one."""
    global _publisher
    _publisher = publisher
