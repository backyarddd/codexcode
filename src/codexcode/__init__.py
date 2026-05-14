"""CodexCode orchestrator package."""
import os

_HERE = os.path.dirname(os.path.abspath(__file__))
_VERSION_FILE = os.path.normpath(os.path.join(_HERE, "..", "..", "VERSION"))

try:
    with open(_VERSION_FILE, "r", encoding="utf-8") as _f:
        __version__ = _f.read().strip()
except FileNotFoundError:
    __version__ = "0.0.0"
