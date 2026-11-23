import pool from "../config/db.js";
import { isTxHash, verifyUsdtBep20Transfer } from "./bscUsdt.js";
import { activateMembership } from "./superkandleAccess.js";

export async function loadCheckoutOrder(paymentId, studentId = null) {
  const params = [paymentId];
  const studentFilter = studentId ? "AND p.student_id = $2" : "";
  if (studentId) params.push(studentId);
  const pending = await pool.query(
    `
    SELECT
      p.id,
      p.student_id,
      p.plan_id,
      p.amount,
      p.status,
      p.tx_hash,
      p.wallet_to,
      p.created_at,
      sp.name AS plan_name,
      sp.is_trial,
      COALESCE(sp.duration_value, sp.duration_months, 1) AS duration_value,
      COALESCE(sp.duration_months, 1) AS duration_months,
      COALESCE(NULLIF(sp.duration_unit, ''), 'month') AS duration_unit
    FROM superkandle_payments p
    JOIN superkandle_plans sp ON sp.id = p.plan_id
    WHERE p.id = $1 ${studentFilter}
    `,
    params
  );
  return pending.rows[0] || null;
}

export async function applyConfirmedPayment(order) {
  return activateMembership({
    studentId: order.student_id,
    plan: {
      id: order.plan_id,
      duration_value: order.duration_value,
      duration_months: order.duration_months,
      duration_unit: order.duration_unit,
    },
    amount: Number(order.amount),
    paymentStatus: "paid",
    paymentMethod: "USDT-BEP20",
    paymentNote: order.tx_hash ? `tx ${order.tx_hash}` : `payment ${order.id}`,
  });
}

export async function confirmUsdtCheckout({ paymentId, txHash, studentId }) {
  const order = await loadCheckoutOrder(paymentId, studentId || null);
  if (!order) {
    const error = new Error("Payment session not found");
    error.status = 404;
    throw error;
  }

  if (order.status === "confirmed") {
    const membership = await applyConfirmedPayment(order);
    return {
      alreadyConfirmed: true,
      paymentId: order.id,
      planId: order.plan_id,
      membership,
      message: "This payment is already confirmed",
    };
  }

  const hash = String(txHash || "").trim();
  if (!isTxHash(hash)) {
    const error = new Error(
      "Paste the BEP20 transaction hash (starts with 0x)"
    );
    error.status = 400;
    throw error;
  }

  const used = await pool.query(
    "SELECT id FROM superkandle_payments WHERE LOWER(tx_hash) = LOWER($1)",
    [hash]
  );
  if (used.rows[0] && Number(used.rows[0].id) !== Number(order.id)) {
    const error = new Error("This transaction was already used");
    error.status = 409;
    throw error;
  }

  const check = await verifyUsdtBep20Transfer({
    txHash: hash,
    expectedAmount: order.amount,
    walletTo: order.wallet_to,
  });
  if (!check.ok) {
    const error = new Error(check.message);
    error.status = 400;
    throw error;
  }

  await pool.query(
    `
    UPDATE superkandle_payments
    SET tx_hash = $1, status = 'confirmed', confirmed_at = NOW()
    WHERE id = $2 AND status <> 'confirmed'
    `,
    [hash, order.id]
  );

  const confirmed = await loadCheckoutOrder(order.id);
  const membership = await applyConfirmedPayment(confirmed);

  return {
    alreadyConfirmed: false,
    paymentId: order.id,
    planId: order.plan_id,
    membership,
    txHash: hash,
    received: check.received,
    message: "Payment confirmed on-chain and membership updated",
  };
}
