import express from "express";
import { requireAuth, requirePower } from "../middleware/auth.js";
import {
  isBep20Address,
  loadSettings,
  publicSettings,
  saveSettings,
} from "../services/portalSettings.js";

const router = express.Router();

router.use(requireAuth);
router.use(requirePower("create_admins"));

router.get("/", async (_req, res) => {
  try {
    const settings = publicSettings(await loadSettings());
    res.json({ success: true, settings });
  } catch (error) {
    console.error("Load settings error:", error.message);
    res.status(500).json({ success: false, message: "Failed to load settings" });
  }
});

router.put("/", async (req, res) => {
  try {
    const wallet = req.body.usdtBep20Wallet;
    if (wallet && String(wallet).trim() && !isBep20Address(wallet)) {
      return res.status(400).json({
        success: false,
        message: "USDT BEP20 wallet must be a valid 0x address",
      });
    }

    const settings = publicSettings(await saveSettings(req.body || {}));
    res.json({
      success: true,
      settings,
      message: "Settings saved",
    });
  } catch (error) {
    console.error("Save settings error:", error.message);
    res.status(500).json({ success: false, message: "Failed to save settings" });
  }
});

export default router;
