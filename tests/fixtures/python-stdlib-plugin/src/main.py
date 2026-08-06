import hashlib


def main(input):
    text = str(input.get("text", ""))
    words = [part for part in text.split() if part]
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]
    return {
        "length": len(text),
        "words": len(words),
        "summary": {
            "sha256Prefix": digest,
            "uppercasePreview": text.upper()[:24],
        },
    }
