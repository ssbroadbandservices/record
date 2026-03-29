import re

with open("script.js", "r") as f:
    content = f.read()

# Fix opening bracket with spaces: "< div" -> "<div"
content = re.sub(r"<\s+([a-zA-Z/])", r"<\1", content)
# Fix closing bracket with spaces: "div >" -> "div>"
content = re.sub(r"(\w|\"|\'|%)\s+>", r"\1>", content)
content = re.sub(r"<\s*/\s*([a-zA-Z])", r"</\1", content)

with open("script.js", "w") as f:
    f.write(content)

print("Done script.js")

with open("index.html", "r") as f:
    content = f.read()

content = re.sub(r"<\s+([a-zA-Z/])", r"<\1", content)
content = re.sub(r"(\w|\"|\'|%)\s+>", r"\1>", content)
content = re.sub(r"<\s*/\s*([a-zA-Z])", r"</\1", content)
with open("index.html", "w") as f:
    f.write(content)

print("Done index.html")
