const express = require("express");
const prisma = require("../lib/prisma");
const { requireAdmin } = require("../lib/adminAuth");
const { generateDeviceId, generateDeviceSecret, encryptSecret } = require("../lib/crypto");

const router = express.Router();

router.use(requireAdmin);

// POST /api/v1/admin/devices/provision
// Body: { label?, projectId?, generatorAddress?, ratedCapacityKw }
// Returns device_secret in PLAINTEXT — the only time it is ever
// returned by any endpoint. Copy it into the device's firmware now.
router.post("/devices/provision", async (req, res) => {
  const { label, projectId, generatorAddress, ratedCapacityKw } = req.body || {};

  if (typeof ratedCapacityKw !== "number" || ratedCapacityKw <= 0) {
    return res.status(400).json({ error: "ratedCapacityKw must be a positive number" });
  }

  const deviceId = generateDeviceId();
  const deviceSecret = generateDeviceSecret();
  const { encryptedSecret, secretIv } = encryptSecret(deviceSecret);

  await prisma.device.create({
    data: {
      deviceId,
      encryptedSecret,
      secretIv,
      label: label ?? null,
      projectId: projectId ?? null,
      generatorAddress: generatorAddress ?? null,
      ratedCapacityKw,
    },
  });

  res.status(201).json({
    device_id: deviceId,
    device_secret: deviceSecret,
    warning: "This secret is shown once and never stored in plaintext. Save it now.",
  });
});

// GET /api/v1/admin/devices — never includes secrets.
router.get("/devices", async (_req, res) => {
  const devices = await prisma.device.findMany({
    select: {
      deviceId: true,
      label: true,
      projectId: true,
      generatorAddress: true,
      ratedCapacityKw: true,
      lastSeq: true,
      status: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(devices);
});

// POST /api/v1/admin/devices/:deviceId/revoke
router.post("/devices/:deviceId/revoke", async (req, res) => {
  const { deviceId } = req.params;

  const device = await prisma.device.findUnique({ where: { deviceId } });
  if (!device) return res.status(404).json({ error: "device not found" });

  await prisma.device.update({
    where: { deviceId },
    data: { status: "revoked" },
  });

  res.json({ device_id: deviceId, status: "revoked" });
});

// POST /api/v1/admin/devices/:deviceId/rebind
// Body: { projectId, generatorAddress }
// mvp-ingestion-decisions.md decision 2: devices are reassignable.
// NOTE: this MVP version only tracks the *current* binding, not
// effective-dated history — a past reading always resolves against
// whatever the device's binding is at query time, not what it was
// when the reading was taken. Fine for a demo; flagged as a real gap
// before this binds real revenue-bearing readings.
router.post("/devices/:deviceId/rebind", async (req, res) => {
  const { deviceId } = req.params;
  const { projectId, generatorAddress } = req.body || {};

  const device = await prisma.device.findUnique({ where: { deviceId } });
  if (!device) return res.status(404).json({ error: "device not found" });

  const updated = await prisma.device.update({
    where: { deviceId },
    data: {
      projectId: projectId ?? device.projectId,
      generatorAddress: generatorAddress ?? device.generatorAddress,
    },
  });

  res.json({
    device_id: updated.deviceId,
    projectId: updated.projectId,
    generatorAddress: updated.generatorAddress,
  });
});

module.exports = router;
