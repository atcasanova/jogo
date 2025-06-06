import json
from datetime import datetime

from config import JSON_LOGGING


def _format_human(level: str, message: str, **kwargs) -> str:
    extra = ' '.join(f"{k}={v}" for k, v in kwargs.items())
    timestamp = datetime.utcnow().isoformat()
    if extra:
        return f"[{timestamp}] [{level}] {message} {extra}"
    return f"[{timestamp}] [{level}] {message}"


def log(level: str, message: str, **kwargs):
    if JSON_LOGGING:
        entry = {'timestamp': datetime.utcnow().isoformat(),
                 'level': level, 'message': message}
        entry.update(kwargs)
        print(json.dumps(entry))
    else:
        print(_format_human(level, message, **kwargs))


def info(message: str, **kwargs):
    log('INFO', message, **kwargs)


def warning(message: str, **kwargs):
    log('WARNING', message, **kwargs)


def error(message: str, **kwargs):
    log('ERROR', message, **kwargs)
