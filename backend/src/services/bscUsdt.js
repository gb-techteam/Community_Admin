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

export async function verifyUsdtBep20Transfer({
  txHash,
  expectedAmount,
  walletTo,
}) {
  const wallet = String(walletTo || (await receiveWallet()) || "")
    .trim()
    .toLowerCase();
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

  let receivedRaw = 0n;
  for (const log of matches) {
    try {
      receivedRaw += BigInt(log.data || "0x0");
    } catch {
      receivedRaw += 0n;
    }
  }
  const expectedRaw = usdtToRaw(expectedAmount);
  const received = Number(receivedRaw) / 1e18;
  if (receivedRaw < expectedRaw) {
    return {
      ok: false,
      message: `This transaction sent ${received.toFixed(2)} USDT. ${Number(expectedAmount).toFixed(2)} USDT is required.`,
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

function logAmount(log) {
  try {
    return Number(BigInt(log.data || "0x0")) / 1e18;
  } catch {
    return 0;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const historyCache = new Map();
const HISTORY_CACHE_MS = 25_000;

function cacheGet(key) {
  const hit = historyCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > HISTORY_CACHE_MS) {
    historyCache.delete(key);
    return null;
  }
  return hit.value;
}

function tokenAmount(value, decimals = 18) {
  try {
    const raw = BigInt(String(value || "0"));
    const places = Math.min(18, Number(decimals) || 18);
    return Number(raw) / 10 ** places;
  } catch {
    return 0;
  }
}

async function fetchExplorerTransfers(wallet) {
  const key = String(process.env.BSCSCAN_API_KEY || "").trim();
  const urls = [
    `https://api.bscscan.com/api?module=account&action=tokentx&contractaddress=${USDT_BEP20}&address=${wallet}&page=1&offset=100&sort=desc${
      key ? `&apikey=${encodeURIComponent(key)}` : ""
    }`,
    `https://bsc.blockscout.com/api?module=account&action=tokentx&contractaddress=${USDT_BEP20}&address=${wallet}&page=1&offset=100&sort=desc`,
  ];

  let lastError = "Explorer unavailable";
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      const payload = await response.json();
      const rows = payload?.result;
      if (payload?.status === "1" && Array.isArray(rows)) return rows;
      if (
        payload?.message === "No transactions found" ||
        (payload?.status === "0" && Array.isArray(rows) && rows.length === 0)
      ) {
        return [];
      }
      lastError = String(payload?.result || payload?.message || lastError);
    } catch (error) {
      lastError = error.message;
    }
  }
  throw new Error(lastError);
}

async function listIncomingFromExplorer(wallet, sinceMs) {
  const rows = await fetchExplorerTransfers(wallet);
  return rows
    .filter((row) => {
      const to = String(row.to || "").toLowerCase();
      const contract = String(row.contractAddress || "").toLowerCase();
      const at = Number(row.timeStamp) * 1000;
      return (
        to === wallet &&
        contract === USDT_BEP20 &&
        Number.isFinite(at) &&
        at >= sinceMs
      );
    })
    .slice(0, 120)
    .map((row) => ({
      txHash: row.hash,
      from: String(row.from || "").toLowerCase(),
      to: wallet,
      amount: tokenAmount(row.value, row.tokenDecimal),
      blockNumber: Number(row.blockNumber) || 0,
      at: new Date(Number(row.timeStamp) * 1000).toISOString(),
    }));
}

async function getLogsChunk(fromBlock, toBlock, topicTo) {
  const logs = await rpc("eth_getLogs", [
    {
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${toBlock.toString(16)}`,
      address: USDT_BEP20,
      topics: [TRANSFER_TOPIC, null, topicTo],
    },
  ]);
  return Array.isArray(logs) ? logs : [];
}

async function listIncomingFromRpc(wallet, maxBlocks) {
  const latestHex = await rpc("eth_blockNumber", []);
  const latest = Number.parseInt(latestHex, 16);
  const span = Math.min(6000, Math.max(200, Number(maxBlocks) || 2000));
  const fromBlock = Math.max(0, latest - span);
  const topicTo = padAddress(wallet);
  const logs = [];
  let failures = 0;
  const step = 200;

  for (let start = fromBlock; start <= latest; start += step) {
    const end = Math.min(latest, start + step - 1);
    try {
      logs.push(...(await getLogsChunk(start, end, topicTo)));
    } catch (error) {
      const message = String(error.message || "");
      if (!/limit exceeded|too many|block range/i.test(message) || start === end) {
        failures += 1;
        continue;
      }
      const mid = Math.floor((start + end) / 2);
      for (const range of [
        [start, mid],
        [mid + 1, end],
      ]) {
        try {
          logs.push(...(await getLogsChunk(range[0], range[1], topicTo)));
        } catch {
          failures += 1;
        }
        await sleep(80);
      }
    }
    await sleep(60);
  }

  if (failures) {
    console.warn(
      `USDT history RPC skipped ${failures} range(s); public nodes often reject busy USDT log queries.`
    );
  }

  logs.sort((a, b) => {
    const block =
      Number.parseInt(b.blockNumber, 16) - Number.parseInt(a.blockNumber, 16);
    if (block) return block;
    return (
      Number.parseInt(b.logIndex || "0x0", 16) -
      Number.parseInt(a.logIndex || "0x0", 16)
    );
  });

  const sliced = logs.slice(0, 120);
  const blockNums = [
    ...new Set(sliced.map((log) => Number.parseInt(log.blockNumber, 16))),
  ];
  const times = {};
  for (let i = 0; i < blockNums.length; i += 4) {
    const batch = blockNums.slice(i, i + 4);
    await Promise.all(
      batch.map(async (blockNumber) => {
        try {
          const block = await rpc("eth_getBlockByNumber", [
            `0x${blockNumber.toString(16)}`,
            false,
          ]);
          times[blockNumber] = block?.timestamp
            ? Number.parseInt(block.timestamp, 16) * 1000
            : null;
        } catch {
          times[blockNumber] = null;
        }
      })
    );
  }

  return {
    fromBlock,
    toBlock: latest,
    transfers: sliced.map((log) => {
      const blockNumber = Number.parseInt(log.blockNumber, 16);
      const at = times[blockNumber];
      return {
        txHash: log.transactionHash,
        from: topicAddress(log.topics?.[1]),
        to: wallet,
        amount: logAmount(log),
        blockNumber,
        at: at ? new Date(at).toISOString() : null,
      };
    }),
  };
}

export async function listIncomingUsdtTransfers({ maxBlocks = 8000 } = {}) {
  const wallet = await receiveWallet();
  if (!wallet || !wallet.startsWith("0x") || wallet.length !== 42) {
    return { ok: false, message: "USDT BEP20 wallet is not configured" };
  }

  const span = Math.min(20000, Math.max(400, Number(maxBlocks) || 8000));
  const sinceMs = Date.now() - span * 3000;
  const cacheKey = `${wallet}:${span}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  let transfers = [];
  let source = "explorer";
  let fromBlock = null;
  let toBlock = null;

  try {
    transfers = await listIncomingFromExplorer(wallet, sinceMs);
  } catch (error) {
    console.warn("USDT history explorer fallback to RPC:", error.message);
    source = "rpc";
    const rpcScan = await listIncomingFromRpc(wallet, Math.min(span, 4000));
    transfers = rpcScan.transfers;
    fromBlock = rpcScan.fromBlock;
    toBlock = rpcScan.toBlock;
  }

  const result = {
    ok: true,
    wallet,
    contract: USDT_BEP20,
    source,
    fromBlock,
    toBlock,
    transfers,
  };
  historyCache.set(cacheKey, { at: Date.now(), value: result });
  return result;
}
