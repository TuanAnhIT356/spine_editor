"""Provider registry. Every provider is BYOK: the caller passes the user's
decrypted key per request."""

from .base import ImageProvider, ProviderError
from .fal import FalProvider
from .mock import MockProvider
from .openai import OpenAIProvider
from .runware import RunwareProvider
from .stability import StabilityProvider

PROVIDERS: dict[str, ImageProvider] = {
    p.name: p
    for p in (
        OpenAIProvider(),
        StabilityProvider(),
        RunwareProvider(),
        FalProvider(),
        MockProvider(),
    )
}

__all__ = ["PROVIDERS", "ImageProvider", "ProviderError"]
