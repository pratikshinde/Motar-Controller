from sqlalchemy.types import UserDefinedType

class LTree(UserDefinedType):
    """
    SQLAlchemy user-defined type for PostgreSQL ltree extension.
    """
    def get_col_spec(self, **kw):
        return "agripump.ltree"

    def bind_processor(self, dialect):
        def process(value):
            if value is None:
                return None
            return str(value)
        return process

    def result_processor(self, dialect, coltype):
        def process(value):
            if value is None:
                return None
            return str(value)
        return process
