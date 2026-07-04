def main(input):
    text = str(input.get("text", ""))
    return {
        "length": len(text),
    }
