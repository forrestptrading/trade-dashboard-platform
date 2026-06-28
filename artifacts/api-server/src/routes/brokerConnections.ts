import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  brokerProviders,
  createBrokerConnection,
  deleteBrokerConnection,
  isBrokerProvider,
  listBrokerConnections,
  updateBrokerConnection,
  type BrokerAccountType,
  type BrokerConnectionStatus,
} from "../services/brokerConnectionsStore.js";

const router: IRouter = Router();

const accountTypeSchema = z.enum(["brokerage", "retirement", "crypto"]);
const statusSchema = z.enum(["connected", "disconnected", "syncing", "error"]);

const createSchema = z.object({
  provider: z.string().refine(isBrokerProvider, {
    message: `Provider must be one of: ${brokerProviders().join(", ")}`,
  }),
  name: z.string().trim().min(1).max(80).optional(),
  account_type: accountTypeSchema.optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  status: statusSchema.optional(),
  account_type: accountTypeSchema.optional(),
});

router.get("/broker-connections", (_req, res) => {
  const data = listBrokerConnections();
  res.json({ success: true, source: "memory", count: data.length, data });
});

router.post("/broker-connections", (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid broker connection", details: parsed.error.flatten().fieldErrors });
    return;
  }

  const connection = createBrokerConnection({
    provider: parsed.data.provider,
    name: parsed.data.name,
    account_type: parsed.data.account_type as BrokerAccountType | undefined,
  });

  res.status(201).json({ success: true, source: "memory", data: connection });
});

router.patch("/broker-connections/:id", (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: "Invalid broker connection update", details: parsed.error.flatten().fieldErrors });
    return;
  }

  const connection = updateBrokerConnection(String(req.params.id), {
    ...parsed.data,
    status: parsed.data.status as BrokerConnectionStatus | undefined,
    account_type: parsed.data.account_type as BrokerAccountType | undefined,
  });

  if (!connection) {
    res.status(404).json({ success: false, error: "Broker connection not found" });
    return;
  }

  res.json({ success: true, source: "memory", data: connection });
});

router.delete("/broker-connections/:id", (req, res) => {
  const deleted = deleteBrokerConnection(String(req.params.id));
  if (!deleted) {
    res.status(404).json({ success: false, error: "Broker connection not found" });
    return;
  }

  res.json({ success: true, source: "memory", id: String(req.params.id) });
});

export default router;
