require("dotenv").config();
const express = require("express");

const adminRouter = require("./routes/admin");
const ingestRouter = require("./routes/ingest");

const app = express();
app.use(express.json());

app.use("/api/v1/admin", adminRouter);
app.use("/api/v1/ingest", ingestRouter);

app.get("/health", (_req, res) => res.json({ ok: true }));

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`backend listening on http://0.0.0.0:${port}`);
});
