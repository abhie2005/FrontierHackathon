// Mode Agent — given a hub's context plus the Risk Agent's assessment, picks the
// transport mode. Defaults to cheapest (rail); on high risk, picks the cheapest
// mode fast enough to close the stockout gap. Deterministic threshold logic.

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
  available_modes: z
    .array(transportMode)
    .describe("Transport modes available on the LA -> hub lane"),
  risk_level: z.enum(["low", "high"]).describe("Risk Agent's risk level"),
  effective_weekly_demand: z
    .number()
    .describe("Spiked weekly demand from the Risk Agent"),
  days_of_stock_left: z
    .number()
    .describe("Runway in days before stockout (Risk Agent)"),
  rail_transit_days: z.number().describe("Rail transit time in days (Risk Agent)"),
  stockout_gap_days: z
    .number()
    .describe("Days rail arrives too late by (Risk Agent)"),
});

type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  hub: z.string(),
  product: z.string(),
  risk_level: z.enum(["low", "high"]),
  stockout_gap_days: z.number(),
  recommended_mode: z.enum(["rail", "truck", "air"]),
  cost: z.number(),
  transit_hrs: z.number(),
  rationale: z.string(),
});

type Output = z.infer<typeof outputSchema>;

const tools = {
  ...consoleTools,
};

type Tools = typeof tools;

async function run(input: Input, task: Task<Tools>): Promise<Output> {
  const byCost = [...input.available_modes].sort((a, b) => a.cost - b.cost);
  const rail = byCost.find((m) => m.mode === "rail")!;

  // Low risk: keep the cheap default plan.
  if (input.risk_level === "low") {
    await task.console.log(`RECOMMEND RAIL — demand within normal range`);
    return {
      hub: input.hub,
      product: input.product,
      risk_level: "low",
      stockout_gap_days: 0,
      recommended_mode: rail.mode,
      cost: rail.cost,
      transit_hrs: rail.transit_hrs,
      rationale: `Demand is within normal range; keeping the cheapest rail plan ($${rail.cost}).`,
    };
  }

  // High risk: pick the cheapest mode that arrives inside the runway.
  const runway_hrs = input.days_of_stock_left * 24;
  const viable = byCost.filter((m) => m.transit_hrs <= runway_hrs);
  const chosen = viable[0] ?? byCost.find((m) => m.mode === "air")!;

  const rationale =
    `Outbreak spikes demand ${Math.round(input.effective_weekly_demand)} units/wk — only ` +
    `~${input.days_of_stock_left} days of stock left, but rail takes ${input.rail_transit_days} days ` +
    `(${input.stockout_gap_days}-day stockout gap). Upgrading to ${chosen.mode} ` +
    `(${chosen.transit_hrs}hrs, $${chosen.cost}) arrives in time — cheapest option that closes the gap.`;

  await task.console.log(
    `RECOMMEND ${chosen.mode.toUpperCase()} — $${chosen.cost} / ${chosen.transit_hrs}hrs`,
  );

  return {
    hub: input.hub,
    product: input.product,
    risk_level: "high",
    stockout_gap_days: input.stockout_gap_days,
    recommended_mode: chosen.mode,
    cost: chosen.cost,
    transit_hrs: chosen.transit_hrs,
    rationale,
  };
}

export default agent({
  inputSchema,
  outputSchema,
  tools,
  run,
});
