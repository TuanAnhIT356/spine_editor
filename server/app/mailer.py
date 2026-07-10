"""Password-reset mail. With SMTP configured it sends a real mail; otherwise the
mail is appended to data/outbox.log so dev/e2e flows can read the token."""

import logging
import smtplib
from email.message import EmailMessage

from .config import config

log = logging.getLogger("spine.mailer")


def send_password_reset(email: str, token: str) -> None:
    body = (
        f"Someone requested a password reset for your Spine Editor account.\n\n"
        f"Reset token: {token}\n\n"
        f"Open {config.frontend_url} , choose 'Reset password' and paste the token.\n"
        f"The token expires in {config.reset_token_minutes} minutes. "
        f"If you didn't request this, ignore this mail."
    )
    if not config.smtp_host:
        log.info("password reset for %s (dev outbox)", email)
        with (config.data_dir / "outbox.log").open("a") as f:
            f.write(f"to={email} subject=Reset your Spine Editor password token={token}\n")
        return
    msg = EmailMessage()
    msg["From"] = config.mail_from
    msg["To"] = email
    msg["Subject"] = "Reset your Spine Editor password"
    msg.set_content(body)
    with smtplib.SMTP(config.smtp_host, config.smtp_port) as smtp:
        smtp.starttls()
        if config.smtp_user:
            smtp.login(config.smtp_user, config.smtp_password)
        smtp.send_message(msg)
