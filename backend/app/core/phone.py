"""Phone number matching, in one place — was defined inside `api/auth.py` and imported sideways from there by
`api/invites.py`; moved here so the new `services/phone_verification.py` (used by both) doesn't have to import a
router module to reach it.
"""


def normalize_phone(phone: str) -> str:
    """Strip everything that is purely presentational (spaces, dashes) so the same real number always
    normalizes to the same string, however it was typed or formatted. Used everywhere a phone is looked up,
    stored, or matched against a phone_verifications/otp_challenges row — those two tables key strictly on
    this normalized form, so a route that skips it (or normalizes differently) will never find its own rows.
    """
    return phone.strip().replace(" ", "").replace("-", "")


def get_phone_variants(phone: str) -> list[str]:
    """The forms a stored number might be in for the same real number: `users.phone`/`phone_number` were
    populated inconsistently over time (with or without +91, with or without the leading 9)."""
    clean = normalize_phone(phone)
    variants = {clean}
    if clean.startswith("+91"):
        variants.add(clean[3:])
        variants.add(clean[1:])
    elif clean.startswith("91") and len(clean) == 12:
        variants.add("+" + clean)
        variants.add(clean[2:])
    elif len(clean) == 10:
        variants.add("+91" + clean)
        variants.add("91" + clean)
    return list(variants)
