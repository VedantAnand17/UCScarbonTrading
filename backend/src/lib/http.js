class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function route(handler) {
  return (req, res, next) => Promise.resolve().then(() => handler(req, res, next)).catch(next);
}

function handleError(err, _req, res, _next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (["entity.parse.failed", "entity.too.large"].includes(err.type)) {
    return res.status(400).json({ error: "invalid JSON request body" });
  }
  if (err.code === "P2002") return res.status(409).json({ error: "record already exists" });
  if (["P2003", "P2025"].includes(err.code)) return res.status(404).json({ error: "record not found" });
  console.error("Request failed:", err.code || err.name);
  return res.status(500).json({ error: "internal server error" });
}

module.exports = { HttpError, route, handleError };
