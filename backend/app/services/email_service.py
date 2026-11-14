"""Sending an email. The only caller today is the admin sign-in code (app/services/email_login.py).

EMAIL_BACKEND:
  "smtp" any mail account that offers SMTP (for example Gmail with an app password): SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD. Easiest to start with.
  "ses"  Amazon SES (the sender address EMAIL_FROM must be verified in SES, and a new SES account can only send to verified addresses until AWS
         gives it production access). Uses the server's AWS role: no key is stored here.
  "log"  writes the email to the server log instead of sending it. Developer machines only (ENV=development): a code in a log would be a leak anywhere else.
  ""     the default: "log" on a developer machine, otherwise "ses".
"""
import logging
import smtplib
import socket
import ssl
from email.message import EmailMessage
from typing import Literal

from app.config import settings

logger = logging.getLogger("agripump.email")


class EmailNotSent(Exception):
    """The email could not be sent (not configured, or the provider refused)."""


def backend_name() -> Literal["log", "ses", "smtp"]:
    name = (settings.EMAIL_BACKEND or "").strip().lower()
    if not name:
        return "log" if settings.dev_codes_enabled else "ses"
    if name == "log" and not settings.dev_codes_enabled:
        # Never write a sign-in code to a log on a real server.
        raise EmailNotSent("EMAIL_BACKEND=log is only allowed when ENV=development.")
    if name not in ("log", "ses", "smtp"):
        raise EmailNotSent(f"Unknown EMAIL_BACKEND '{name}'.")
    return name  # type: ignore[return-value]


def is_real() -> bool:
    """True when emails really go out (so no development shortcut may stand in for the code in one)."""
    try:
        return backend_name() != "log"
    except EmailNotSent:
        return True


def send_email(to: str, subject: str, body: str) -> None:
    """Send a plain-text email, or raise EmailNotSent."""
    name = backend_name()
    if name == "log":
        logger.warning("EMAIL (not sent, development) to=%s subject=%s\n%s", to, subject, body)
        return
    if name == "smtp":
        _send_smtp(to, subject, body)
        return
    sender = (settings.EMAIL_FROM or "").strip()
    if not sender:
        raise EmailNotSent("EMAIL_FROM is not set.")
    try:
        import boto3

        client = boto3.client("ses", region_name=settings.AWS_REGION)
        client.send_email(
            Source=sender,
            Destination={"ToAddresses": [to]},
            Message={"Subject": {"Data": subject, "Charset": "UTF-8"}, "Body": {"Text": {"Data": body, "Charset": "UTF-8"}}},
        )
    except Exception as exc:  # the provider's own message can name the address: keep it out of the caller's response, in the log only
        logger.error("SES could not send an email: %s", exc)
        raise EmailNotSent("The email could not be sent.") from exc


def _connect(host: str, port: int, timeout, source_address=None) -> socket.socket:
    """Open the connection trying IPv4 addresses first: on a network with no working IPv6 the IPv6 attempt waits for its timeout before falling back."""
    last: Exception = OSError(f"could not resolve {host}")
    infos = sorted(socket.getaddrinfo(host, port, 0, socket.SOCK_STREAM), key=lambda i: 0 if i[0] == socket.AF_INET else 1)
    for family, kind, proto, _name, address in infos:
        sock = socket.socket(family, kind, proto)
        try:
            sock.settimeout(timeout)
            if source_address:
                sock.bind(source_address)
            sock.connect(address)
            return sock
        except OSError as exc:
            last = exc
            sock.close()
    raise last


class _Smtp(smtplib.SMTP):
    def _get_socket(self, host, port, timeout):
        return _connect(host, port, timeout, self.source_address)


class _SmtpSsl(smtplib.SMTP_SSL):
    def _get_socket(self, host, port, timeout):
        return self.context.wrap_socket(_connect(host, port, timeout, self.source_address), server_hostname=self._host)


def _send_smtp(to: str, subject: str, body: str) -> None:
    # A Google app password is shown as four groups of four letters; it works typed with or without the spaces, so they are dropped here.
    host, user, password = (settings.SMTP_HOST or "").strip(), (settings.SMTP_USER or "").strip(), (settings.SMTP_PASSWORD or "").replace(" ", "")
    if not host or not user or not password:
        raise EmailNotSent("SMTP_HOST, SMTP_USER and SMTP_PASSWORD must all be set.")
    sender = (settings.EMAIL_FROM or "").strip() or user
    message = EmailMessage()
    message["From"] = sender
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)
    port = int(settings.SMTP_PORT or 587)
    try:
        context = ssl.create_default_context()
        if port == 465:
            with _SmtpSsl(host, port, context=context, timeout=20) as smtp:
                smtp.login(user, password)
                smtp.send_message(message)
        else:
            with _Smtp(host, port, timeout=20) as smtp:
                smtp.starttls(context=context)
                smtp.login(user, password)
                smtp.send_message(message)
    except Exception as exc:  # never put the provider's message (it can echo the address or the login) in a response
        logger.error("SMTP could not send an email: %s", exc)
        raise EmailNotSent("The email could not be sent.") from exc
