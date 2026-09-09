// TEMP stand-in for prd.md's JWT + RBAC admin auth. A single shared
// key checked against Authorization: Bearer <key>. Swap for real
// JWT+role checks later without touching device/ingestion logic —
// they only depend on this middleware existing, not how it decides.
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");

  if (scheme !== "Bearer" || !token || token !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }

  next();
}

module.exports = { requireAdmin };
