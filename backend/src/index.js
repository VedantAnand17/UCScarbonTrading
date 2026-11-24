require("dotenv").config();
const { jwtSecret } = require("./lib/auth");
const app = require("./app");

jwtSecret();
const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`backend listening on http://0.0.0.0:${port}`);
});
