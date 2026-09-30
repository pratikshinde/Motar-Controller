"""Sub-tree matching on hierarchy paths, in one place.

`/SA/D1` must cover `/SA/D1` and `/SA/D1/anything`, and never `/SA/D10`. A plain prefix match (`startswith(path)`)
gets that wrong, and so does SQL `LIKE path || '%'`, in which `_` and `%` inside a path are wildcards too.
"""
from sqlalchemy import false, or_


def normalise(path) -> str:
    return (path or "").rstrip("/")


def in_subtree(column, path):
    """SQL condition: `column` is `path` itself or below it. An empty path matches nothing (never everything)."""
    p = normalise(path)
    if not p:
        return false()
    return or_(column == p, column.startswith(p + "/", autoescape=True))


def path_in_scope(scope_path, candidate) -> bool:
    """Python counterpart of `in_subtree`, for values already in memory.
    Supports both legacy slash-separated paths (/SA/D1) and PostgreSQL ltree dot-separated paths (root.mfg.dist).
    """
    if not scope_path or not candidate:
        return False
    mine_str = str(scope_path).strip()
    theirs_str = str(candidate).strip()
    if not mine_str or not theirs_str:
        return False

    # Exact match
    if mine_str == theirs_str:
        return True

    # Slash-delimited path (/SA/...)
    mine_slash = mine_str.rstrip("/")
    theirs_slash = theirs_str.rstrip("/")
    if theirs_slash == mine_slash or theirs_slash.startswith(mine_slash + "/"):
        return True

    # Dot-delimited ltree path (root.org1.org2...)
    mine_dot = mine_str.rstrip(".")
    theirs_dot = theirs_str.rstrip(".")
    if theirs_dot == mine_dot or theirs_dot.startswith(mine_dot + "."):
        return True

    return False
