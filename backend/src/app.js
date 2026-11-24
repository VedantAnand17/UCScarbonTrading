const express = require("express");
const { Prisma } = require("@prisma/client");
const { HttpError, handleError } = require("./lib/http");

const app = express();
app.disable("x-powered-by");
app.set("json replacer", function (key, value) {
  if (typeof value === "bigint") return value.toString();
  const original = this[key];
  return Prisma.Decimal.isDecimal(original) ? original.toFixed() : value;
});
app.use(express.json());
app.get("/health", (_req, res) => res.json({ ok: true }));

const api = express.Router();
api.use("/auth", require("./routes/auth"));
api.use("/ingest", require("./routes/ingest"));
api.use("/generator", require("./routes/generator"));
api.use("/admin", require("./routes/admin"));
api.use("/listings", require("./routes/listings"));
api.use("/trades", require("./routes/trades"));
app.use("/api/v1", api);

app.use((_req, _res, next) => next(new HttpError(404, "route not found")));
app.use(handleError);

module.exports = app;
