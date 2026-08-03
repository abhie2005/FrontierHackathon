// Risk Agent — reads a hub's context (stock, demand, live outbreak multiplier,
// transport modes) and decides whether the demand spike risks a stockout before
// the default rail restock arrives. Deterministic threshold logic.

"use agent";

import {
  type Task,
  consoleTools,
  agent,
} from "@guildai/agents-sdk";
import { z } from "zod";

const transportMode = z.object({
  mode: z.enum(["rail", "truck", "air"]),
  cost: z.number(),
  transit_hrs: z.number(),
});

const inputSchema = z.object({
  hub: z.string().describe("Hub name, e.g. Ohio"),
  product: z.string().describe("Product name, e.g. ColdRelief-500"),
  current_stock: z.number().describe("Units currently in stock at the hub"),
  avg_weekly_demand: z.number().describe("Baseline average weekly demand (units)"),
  live_demand_multiplier: z
    .number()
    .describe("Live demand multiplier from the outbreak signal, e.g. 3.2"),
  available_modes: z
    .array(transportMode)
    .describe("Transport modes available on the LA -> hub lane"),
});

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  hub: z.string(),
  risk_level: z.enum(["low", "high"]),
  effective_weekly_demand: z.number(),
  days_of_stock_left: z.number(),
  rail_transit_days: z.number(),
  stockout_gap_days: z.number(),
});

type Output = z.infer<typeof outputSchema>;

const tools = {
  ...consoleTools,
};

type Tools = typeof tools;

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

async function run(input: Input, task: Task<Tools>): Promise<Output> {
  const effective_weekly_demand =
    input.avg_weekly_demand * input.live_demand_multiplier;
  const daily_burn = effective_weekly_demand / 7;
  const days_of_stock_left = input.current_stock / daily_burn;

  const rail = input.available_modes.find((m) => m.mode === "rail");
  if (!rail) throw new Error(`No rail mode for hub ${input.hub}`);
  const rail_transit_days = rail.transit_hrs / 24;

  const at_risk = days_of_stock_left < rail_transit_days;
  const stockout_gap_days = at_risk
    ? round(rail_transit_days - days_of_stock_left)
    : 0;

  await task.console.log(
    at_risk
      ? `RISK HIGH — ~${round(days_of_stock_left)}d stock vs ${round(
          rail_transit_days,
        )}d rail => ${stockout_gap_days}d stockout gap`
      : `RISK LOW — ${round(days_of_stock_left)}d stock covers ${round(
          rail_transit_days,
        )}d rail lead time`,
  );

  return {
    hub: input.hub,
    risk_level: at_risk ? "high" : "low",
    effective_weekly_demand: round(effective_weekly_demand),
    days_of_stock_left: round(days_of_stock_left),
    rail_transit_days: round(rail_transit_days),
    stockout_gap_days,
  };
}

export default agent({
  inputSchema,
  outputSchema,
  tools,
  run,
});
