import { loadSettings } from "./portalSettings.js";

const USDT_BEP20 = "0x55d398326f99059ff775485246999027b3197955";
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export async function receiveWallet() {
  const settings = await loadSettings();
  return String(settings.usdtBep20Wallet || "").trim().toLowerCase();
}

export function isTxHash(value) {
  return /^0x[a-fA-F0-9]{64}$/.test(String(value || "").trim());
}

export function formatUsdtAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "0.000000";
  return (Math.round(n * 1e6) / 1e6).toFixed(6);
}

export function usdtToRaw(value) {
  const [whole, frac = ""] = formatUsdtAmount(value).split(".");
  return BigInt(`${whole}${frac.padEnd(18, "0")}`);
}

function padAddress(address) {
  return `0x${String(address || "")
    .replace(/^0x/i, "")
    .toLowerCase()
    .padStart(64, "0")}`;
}

function topicAddress(topic) {
  if (!topic) return "";
  return `0x${String(topic).slice(-40).toLowerCase()}`;
}

function hexToUsdt(data) {
  try {
    const raw = BigInt(data);
    return Number(raw) / 1e18;
  } catch {
    return 0;
  }
}

async function rpc(method, params) {
  const settings = await loadSettings();
  const response = await fetch(
    settings.bscRpcUrl || "https://bsc-dataseed.binance.org",
    {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });
  const payload = await response.json();
  if (payload.error) {
    throw new Error(payload.error.message || "BSC RPC error");
  }
  return payload.result;
}

export async function verifyUsdtBep20Transfer({ txHash, expectedAmount }) {
  const wallet = await receiveWallet();
  if (!wallet || !wallet.startsWith("0x") || wallet.length !== 42) {
    return { ok: false, message: "USDT BEP20 wallet is not configured" };
  }
  if (!isTxHash(txHash)) {
    return { ok: false, message: "Enter a valid BEP20 transaction hash" };
  }

  const receipt = await rpc("eth_getTransactionReceipt", [txHash]);
  if (!receipt) {
    return {
      ok: false,
      message: "Transaction not found yet. Wait for confirmation and try again.",
    };
  }
  if (String(receipt.status) !== "0x1") {
    return { ok: false, message: "That transaction failed on-chain" };
  }

  const expected = Number(expectedAmount);
  const logs = Array.isArray(receipt.logs) ? receipt.logs : [];
  const matches = logs.filter((log) => {
    const topics = log.topics || [];
    return (
      String(log.address || "").toLowerCase() === USDT_BEP20 &&
      String(topics[0] || "").toLowerCase() === TRANSFER_TOPIC &&
      topicAddress(topics[2]) === wallet
    );
  });

  if (!matches.length) {
    return {
      ok: false,
      message: `No USDT (BEP20) transfer to ${wallet} was found in this transaction`,
    };
  }

  const received = matches.reduce((sum, log) => sum + hexToUsdt(log.data), 0);
  if (!Number.isFinite(expected) || received + 0.000001 < expected) {
    return {
      ok: false,
      message: `This transaction sent ${received.toFixed(2)} USDT. ${expected.toFixed(2)} USDT is required.`,
    };
  }

  return {
    ok: true,
    received,
    wallet,
    txHash,
    toTopic: padAddress(wallet),
  };
}

export async function findIncomingUsdtPayment({ expectedAmount, since }) {
  const wallet = await receiveWallet();
  if (!wallet || !wallet.startsWith("0x") || wallet.length !== 42) {
    return { ok: false, message: "USDT BEP20 wallet is not configured" };
  }

  const expectedRaw = usdtToRaw(expectedAmount);
  const latestHex = await rpc("eth_blockNumber", []);
  const latest = Number.parseInt(latestHex, 16);
  const ageSec = Math.max(
    60,
    (Date.now() - new Date(since || Date.now()).getTime()) / 1000
  );
  const lookback = Math.min(4000, Math.max(80, Math.ceil(ageSec / 3) + 40));
  const fromBlock = Math.max(0, latest - lookback);
  const topicTo = padAddress(wallet);
  const chunk = 1000;

  for (let start = fromBlock; start <= latest; start += chunk) {
    const end = Math.min(latest, start + chunk - 1);
    let logs = [];
    try {
      logs = await rpc("eth_getLogs", [
        {
          fromBlock: `0x${start.toString(16)}`,
          toBlock: `0x${end.toString(16)}`,
          address: USDT_BEP20,
          topics: [TRANSFER_TOPIC, null, topicTo],
        },
      ]);
    } catch (error) {
      console.error("USDT log scan error:", error.message);
      continue;
    }

    const matches = (Array.isArray(logs) ? logs : []).filter((log) => {
      const topics = log.topics || [];
      return (
        String(log.address || "").toLowerCase() === USDT_BEP20 &&
        String(topics[0] || "").toLowerCase() === TRANSFER_TOPIC &&
        topicAddress(topics[2]) === wallet &&
        BigInt(log.data || "0x0") === expectedRaw
      );
    });

    if (matches.length) {
      const log = matches[matches.length - 1];
      return {
        ok: true,
        txHash: log.transactionHash,
        received: Number(formatUsdtAmount(expectedAmount)),
        wallet,
      };
    }
  }

  return {
    ok: false,
    pending: true,
    message:
      "Payment not seen on BNB Smart Chain yet. Send the exact USDT amount and wait a minute.",
  };
}
